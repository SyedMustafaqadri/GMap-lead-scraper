(function () {
  if (self.GMLE.__contentLoaded) return; // guard against re-injection double loops
  self.GMLE.__contentLoaded = true;

  var cfg = GMLE.config;
  var running = false;
  var jobId = null;
  var captchaPaused = false;
  var seenLocal = new Set();
  var noAnchorStreak = 0;
  var loopCount = 0;
  var cyclesUntilPause = 0;
  var cooldownUsed = false;
  var lastWaitMs = 0;
  var jobFields = GMLE.FIELDS;
  // Phase 2 (detail-panel visiting): leads missing phone/website, in extract
  // order. leadIndex keeps every extracted lead so the queue can be built
  // once the feed is exhausted.
  var leadIndex = {};
  var visitQueue = [];
  var visitTotal = 0;
  var endReason = null;
  // Spinner patience: while the feed shows a loading indicator we are NOT in
  // a dead cycle — the next page is in flight (2026-08-30 run: Google's
  // loader hung on its spinner and the loop ended the job prematurely).
  var loadingMs = 0;
  var loadingDiag = false;

  function randBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  // ---- hidden-tab-safe sleep ------------------------------------------------
  // Chrome throttles hidden-tab timers to ~1/min, which would stall the loop
  // when the user switches windows. When hidden, waits are delegated to the
  // service worker: SCHEDULE_TICK -> SW setTimeout -> LOOP_TICK round trip.
  // Messages into a hidden tab are delivered instantly (not throttled), and
  // the round trips keep the worker alive.
  var tickSeq = 0;
  var tickWaiters = {};
  function gmSleep(ms) {
    return new Promise(function (resolve) {
      if (!document.hidden) { setTimeout(resolve, ms); return; }
      var id = ++tickSeq;
      tickWaiters[id] = resolve;
      GMLE.post(GMLE.MSG.SCHEDULE_TICK, { delayMs: Math.round(ms), tickId: id });
    });
  }

  function isMaps() { return /google\.[a-z.]+\/maps/.test(location.href); }
  function getSearch() { return (document.title || '').replace(/\s*-\s*Google Maps\s*$/i, '').trim(); }
  function getFeed() {
    return document.querySelector(GMLE.selectors.feed) ||
      document.querySelector(GMLE.selectors.appRoot);
  }
  function countAnchors() {
    return document.querySelectorAll(GMLE.selectors.placeLinks).length;
  }
  function diag() {
    var sample = [];
    var as = document.querySelectorAll('a[href*="maps/place"]');
    for (var i = 0; i < Math.min(2, as.length); i++) sample.push(as[i].href.slice(0, 80));
    var fed = document.querySelector(GMLE.selectors.feed);
    return {
      jobId: jobId,
      isMaps: isMaps(),
      feed: !!getFeed(),
      anchorsPlace: countAnchors(),
      totalAnchors: document.querySelectorAll('a[href^="http"]').length,
      hrefSample: sample,
      href: location.href.slice(0, 120),
      feedH: fed ? fed.scrollHeight : 0,
      feedTop: fed ? Math.round(fed.scrollTop) : 0,
      spinner: feedSpinner(),
      bottom: atBottom(),
      streak: noAnchorStreak,
      lastWaitMs: lastWaitMs,
      cooldownUsed: cooldownUsed
    };
  }
  function detectCaptcha() {
    if (document.querySelector('iframe[src*="captcha"], iframe[src*="recaptcha"]')) return true;
    return /unusual traffic|please show you'?re not a robot|our systems have detected/i.test(document.body.innerText);
  }
  function detectEnd() {
    return /you'?ve reached the end of|end of .*list|no (more|further) results/i.test(document.body.innerText);
  }
  // Loading indicator inside the feed (stable hooks only: progressbar role,
  // aria-busy, or "Loading" text at the feed tail where the spinner lives).
  function feedSpinner() {
    var fed = document.querySelector(GMLE.selectors.feed);
    if (!fed) return false;
    if (fed.querySelector('[role="progressbar"], [aria-busy="true"]')) return true;
    return /loading/i.test((fed.innerText || '').slice(-600));
  }
  // Near/at the bottom — the pagination trigger zone where the next page
  // loads (or the spinner hangs). Waits must be longer there.
  function atBottom() {
    var fed = document.querySelector(GMLE.selectors.feed);
    if (!fed) return false;
    var view = fed.clientHeight || 600;
    return fed.scrollHeight - fed.scrollTop - view <= view * 0.5;
  }
  function isFeedHealthy() {
    return !feedSpinner() && countAnchors() > 0;
  }
  function sendStatus() {
    var ready = !!getFeed() && isMaps();
    GMLE.post(GMLE.MSG.MAPS_STATUS, {
      ready: ready,
      search: getSearch(),
      reason: ready ? 'ok' : 'no-feed'
    });
  }

  function extractAll() {
    var anchors = document.querySelectorAll(GMLE.selectors.placeLinks);
    var leads = [];
    for (var i = 0; i < anchors.length; i++) {
      var lead = GMLE.extractors.fromAnchor(anchors[i]);
      if (!lead) continue; // sponsored card — skipped wholesale
      var f = GMLE.fingerprint(lead);
      if (seenLocal.has(f)) continue;
      seenLocal.add(f);
      leadIndex[f] = lead;
      leads.push(lead);
    }
    return leads;
  }

  // Feed growth signature: scrollHeight + anchor count. Used to detect that a
  // pagination page actually landed before extracting/scrolling again — this
  // keeps our requests single-flight (measured healthy baseline in the HAR:
  // one page per ~6-10s, never a trigger while the previous one is in flight).
  function feedMetrics() {
    var fed = document.querySelector(GMLE.selectors.feed) || getFeed();
    return {
      h: fed ? fed.scrollHeight : 0,
      a: countAnchors()
    };
  }

  // Grow-OR-shrink counts as "a page landed": Maps may virtualize early cards
  // away (height shrinks) while appending new ones.
  function waitForFeedChange(prev, budgetMs) {
    var start = Date.now();
    return new Promise(function (resolve) {
      function poll() {
        if (!running) { resolve({ changed: false, waitedMs: Date.now() - start }); return; }
        var cur = feedMetrics();
        if (cur.h !== prev.h || cur.a !== prev.a) { resolve({ changed: true, waitedMs: Date.now() - start }); return; }
        if (Date.now() - start >= budgetMs) { resolve({ changed: false, waitedMs: Date.now() - start }); return; }
        gmSleep(cfg.scroll.changeWaitPollMs).then(poll);
      }
      gmSleep(cfg.scroll.changeWaitPollMs).then(poll);
    });
  }

  // Step smoothly down the feed; when close enough, glide fully to the
  // bottom — reaching the bottom IS the pagination trigger, so never stop
  // short of it (an earlier margin cap prevented loading entirely). With
  // stalled growth (force), jump straight to the bottom so the trigger
  // fires and the long bottom-wait budgets take over.
  function scrollFeedStep(force) {
    var fed = document.querySelector(GMLE.selectors.feed);
    if (!fed) {
      var root = getFeed();
      if (root && root.scrollHeight) root.scrollTop = root.scrollHeight;
      if (window.scrollBy) window.scrollBy(0, 600);
      return;
    }
    var view = fed.clientHeight || 600;
    var maxTop = Math.max(0, fed.scrollHeight - view);
    var distance = maxTop - fed.scrollTop;
    var step = view * randBetween(cfg.scroll.stepMin, cfg.scroll.stepMax);
    var target = (force || distance <= step || distance <= view * 1.5)
      ? maxTop                      // in reach — glide to the bottom
      : fed.scrollTop + step;       // gradual human-like approach
    target = Math.min(target, maxTop);
    if (target <= fed.scrollTop) return;
    if (fed.scrollTo) fed.scrollTo({ top: target, behavior: document.hidden ? 'auto' : 'smooth' });
    else fed.scrollTop = target;
  }

  // ---- phase 2: detail-panel visiting (phone / website / better address) ----
  // The detail-page fetch() path was silently intercepted by Maps' page
  // service worker / CSP (2026-08-30 restaurant run: zero results, zero
  // errors), so it was removed. Instead, once the feed is exhausted we visit
  // each lead's card: click its place anchor (SPA navigation — never
  // location.href, which would reload the page and kill this script), scrape
  // the opened detail panel via data-item-id hooks, close it, wait for the
  // feed to return, then move to the next lead.

  function fieldsWant() {
    return {
      phone: jobFields.some(function (f) { return f.key === 'phone'; }),
      site: jobFields.some(function (f) { return f.key === 'website' || f.key === 'email'; })
    };
  }

  function buildVisitQueue() {
    visitQueue = [];
    var want = fieldsWant();
    if (!want.phone && !want.site) return;
    for (var fp in leadIndex) {
      var l = leadIndex[fp];
      if (!l.mapsUrl) continue;
      if ((want.phone && !l.phone) || (want.site && !l.website)) visitQueue.push(l);
    }
    visitTotal = visitQueue.length;
  }

  // Feed exhausted → run phase 2 (if any leads need it), then DONE. The DONE
  // must wait until the visit queue drains so the export has the panel data.
  // The feed must be healthy before the first click: clicking into a stalled
  // feed and closing the panel destroyed the search session on the
  // 2026-08-30 run (empty feed, URL dropped to /maps/@lat,lng, all remaining
  // visits lost).
  function endOfFeed(reason) {
    if (!running) return;
    endReason = reason || 'end';
    if (endReason === 'end') { tryPhase2(); return; }
    // 'no-results' — the feed may just be slow (spinner still up, next page
    // in flight). Give it one last window to settle: if the end-of-list
    // marker appears we continue to phase 2; if more results arrive we
    // resume scrolling; otherwise give up for real.
    waitFeedSettle(cfg.scroll.endConfirmTimeoutMs).then(function (res) {
      if (!running) return;
      if (res === 'recovered') {
        noAnchorStreak = 0;
        loadingMs = 0;
        GMLE.post(GMLE.MSG.DIAG, Object.assign({ reason: 'feed-recovered-resume' }, diag()));
        loop();
        return;
      }
      if (res === 'end') { endReason = 'end'; tryPhase2(); return; }
      GMLE.post(GMLE.MSG.DIAG, Object.assign({ reason: 'phase2-skipped-feed-unhealthy' }, diag()));
      finishNow();
    });
  }

  // Wait for the feed to settle after a stall. Resolves:
  //   'end'       — end-of-list marker visible and no spinner (feed is done)
  //   'recovered' — more anchors arrived (feed was slow, not finished)
  //   'giveup'    — neither happened within timeoutMs
  function waitFeedSettle(timeoutMs) {
    var baseline = countAnchors();
    var start = Date.now();
    return new Promise(function (resolve) {
      function poll() {
        if (!running) { resolve('giveup'); return; }
        if (detectEnd() && !feedSpinner()) { resolve('end'); return; }
        if (countAnchors() > baseline) { resolve('recovered'); return; }
        if (Date.now() - start >= timeoutMs) { resolve('giveup'); return; }
        gmSleep(500).then(poll);
      }
      gmSleep(500).then(poll);
    });
  }

  function tryPhase2() {
    if (!running) return;
    buildVisitQueue();
    if (!visitQueue.length) { finishNow(); return; }
    if (!isFeedHealthy()) {
      // Busy feed — one short wait for it to become clickable, then skip.
      waitFeedSettle(cfg.visit.feedReadyTimeoutMs).then(function (res) {
        if (!running) return;
        if (res === 'end' && isFeedHealthy()) { beginVisits(); return; }
        GMLE.post(GMLE.MSG.DIAG, Object.assign({ reason: 'phase2-skipped-feed-unhealthy' }, diag()));
        finishNow();
      });
      return;
    }
    beginVisits();
  }

  function beginVisits() {
    GMLE.post(GMLE.MSG.DIAG, Object.assign({ reason: 'phase2-start', visits: visitQueue.length }, diag()));
    visitNext();
  }

  function finishNow() {
    running = false;
    GMLE.post(GMLE.MSG.DONE, { jobId: jobId, reason: endReason || 'end' });
    // Courtesy close AFTER DONE: the export is already triggered, so even if
    // Maps' close handler resets the page, nothing is at stake. Fire and
    // forget — if Maps ignores the synthetic Escape, the panel just stays
    // open for the user to close manually.
    if (document.querySelector('button[data-item-id="address"], a[data-item-id^="authority"]')) {
      escapeClose();
    }
  }

  function visitNext() {
    if (!running) return;
    // CAPTCHA gate before each visit (same pause path as the scroll loop).
    if (detectCaptcha()) {
      if (!captchaPaused) {
        captchaPaused = true;
        GMLE.post(GMLE.MSG.CAPTCHA, { jobId: jobId });
      }
      gmSleep(cfg.captchaPollMs).then(function () {
        if (captchaPaused && !detectCaptcha()) {
          captchaPaused = false;
          GMLE.post(GMLE.MSG.RESUMED, { jobId: jobId });
        }
        visitNext();
      });
      return;
    }
    if (captchaPaused) {
      captchaPaused = false;
      GMLE.post(GMLE.MSG.RESUMED, { jobId: jobId });
    }
    if (!visitQueue.length) { finishNow(); return; }
    visitLead(visitQueue[0]);
  }

  // Locate the card's place anchor by its /maps/place/ href (matched against
  // the stored mapsUrl prefix). Virtualized-away cards get one retry after
  // scrolling the feed back to the top; if it's still gone, the lead is skipped.
  function findCardAnchor(mapsUrl) {
    function search() {
      var as = document.querySelectorAll('a[href*="/maps/place/"]');
      for (var i = 0; i < as.length; i++) {
        var href = (as[i].href || '').split('?')[0];
        if (href === mapsUrl || href.indexOf(mapsUrl) === 0 || mapsUrl.indexOf(href) === 0) return as[i];
      }
      return null;
    }
    var hit = search();
    if (hit) return Promise.resolve(hit);
    var fed = document.querySelector(GMLE.selectors.feed);
    if (!fed) return Promise.resolve(null);
    fed.scrollTop = 0;
    return gmSleep(1500).then(search);
  }

  // Panel is open when a div[role="main"] whose aria-label matches the place
  // name appears. Name matching is the ONLY signal: with close-less visiting
  // the previous place's data-item-id buttons can linger briefly during a
  // panel swap, so the address-button heuristic would false-positive.
  function normName(s) { return (s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

  function findPanel(name) {
    var norm = normName(name);
    if (!norm) return null;
    var mains = document.querySelectorAll('div[role="main"][aria-label]');
    for (var i = 0; i < mains.length; i++) {
      var al = normName(mains[i].getAttribute('aria-label'));
      if (al && (al === norm || al.indexOf(norm) !== -1)) return mains[i];
    }
    return null;
  }

  function panelOpen(name) {
    return !!findPanel(name);
  }

  function waitForPanel(name, timeoutMs) {
    var start = Date.now();
    return new Promise(function (resolve) {
      function poll() {
        if (!running) { resolve(false); return; }
        if (panelOpen(name)) { resolve(true); return; }
        if (Date.now() - start >= timeoutMs) { resolve(false); return; }
        gmSleep(250).then(poll);
      }
      gmSleep(250).then(poll);
    });
  }

  // ---- close-less visiting (the Close button resets the session) -----------
  // Clicking the native Close button fires Maps' jsaction handler, which
  // history.back()s past the search entry to the landing URL (observed twice
  // live: Dallas and Sacramento — URL fell to /maps/@lat,lng?entry=ttu, the
  // feed emptied, every remaining visit was lost; Escape and the outer
  // jsaction span were verified to NOT work on the live page either). So the
  // visit loop never closes anything: the search feed stays alive in the DOM
  // behind the open panel, and clicking the NEXT card's anchor swaps the
  // panel content in place (place→place navigation pushes forward in
  // history — the reset trigger is never touched). One courtesy Escape runs
  // after DONE, when the export is already triggered and nothing is at risk.
  function searchRouteIntact() {
    return /\/maps\/search\//.test(location.href);
  }

  function keyEvent(type) {
    try {
      return new KeyboardEvent(type, {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
        bubbles: true, cancelable: true
      });
    } catch (e) {
      return { type: type, key: 'Escape', keyCode: 27, bubbles: true }; // non-browser env
    }
  }

  function escapeClose() {
    var anchor = document.querySelector('button[data-item-id="address"]');
    var target = (anchor && anchor.closest && anchor.closest('div[role="main"]')) || document.body;
    target.dispatchEvent(keyEvent('keydown'));
    target.dispatchEvent(keyEvent('keyup'));
  }

  // Scrape the open detail panel (hooks per the 2026-08-30 DOM capture; aria/
  // role/data-item-id only — never minified class names, D-004). Queries are
  // scoped to THIS lead's panel so a lingering previous panel during a swap
  // can never leak its data into the wrong lead.
  function scrapePanel(lead) {
    var updates = {};
    var scope = findPanel(lead.name) || document;
    var pbtn = scope.querySelector('button[data-item-id^="phone"]');
    if (pbtn) {
      var ptext = (pbtn.innerText || '').trim() ||
        (pbtn.getAttribute('aria-label') || '').replace(/^phone\s*:\s*/i, '');
      var ph = GMLE.extractors._phoneFromText(ptext);
      if (ph) updates.phone = ph;
    }
    var wlink = scope.querySelector('a[data-item-id^="authority"]');
    if (wlink && /^https?:/i.test(wlink.href || '')) updates.website = wlink.href;
    var abtn = scope.querySelector('button[data-item-id="address"]');
    if (abtn) {
      var atext = (abtn.getAttribute('aria-label') || '').replace(/^address\s*:\s*/i, '').trim() ||
        (abtn.innerText || '').trim();
      if (atext) updates.address = atext;
    }
    return updates;
  }

  function visitLead(lead) {
    findCardAnchor(lead.mapsUrl).then(function (anchor) {
      if (!running) return;
      if (!anchor) {
        // If the search session is gone (route dropped) or the feed has no
        // cards at all (the reset leaves an empty feed shell behind), every
        // remaining visit would fail — abort cleanly instead of one by one.
        if (!searchRouteIntact() || countAnchors() === 0) {
          GMLE.post(GMLE.MSG.DIAG, Object.assign({
            reason: 'phase2-search-reset', remaining: visitQueue.length, name: lead.name
          }, diag()));
          visitQueue = [];
          finishNow();
          return;
        }
        GMLE.post(GMLE.MSG.DIAG, Object.assign({ reason: 'phase2-card-not-found', name: lead.name }, diag()));
        visitQueue.shift();
        afterVisit();
        return;
      }
      anchor.click(); // SPA navigation — never location.href (kills the script)
      waitForPanel(lead.name, cfg.visit.panelTimeoutMs).then(function (open) {
        if (!running) return;
        if (!open) {
          GMLE.post(GMLE.MSG.DIAG, Object.assign({ reason: 'phase2-panel-timeout', name: lead.name }, diag()));
          continueToNextVisit(lead, {});
          return;
        }
        var updates = scrapePanel(lead);
        if (updates.phone || updates.website || updates.address) {
          GMLE.post(GMLE.MSG.LEADS_ENRICHED, { jobId: jobId, fp: GMLE.fingerprint(lead), updates: updates });
        }
        continueToNextVisit(lead, updates);
      });
    });
  }

  // No close, no reset: the panel stays open; the next card click swaps its
  // content. Only the visit bookkeeping happens here.
  function continueToNextVisit(lead, updates) {
    visitQueue.shift();
    GMLE.post(GMLE.MSG.DIAG, Object.assign({
      reason: 'phase2-visit',
      name: lead.name,
      index: visitTotal - visitQueue.length,
      total: visitTotal,
      gotPhone: !!updates.phone,
      gotWebsite: !!updates.website,
      gotAddress: !!updates.address
    }, diag()));
    gmSleep(randBetween(cfg.visit.delayMinMs, cfg.visit.delayMaxMs)).then(visitNext);
  }

  function afterVisit() {
    gmSleep(randBetween(cfg.visit.delayMinMs, cfg.visit.delayMaxMs)).then(visitNext);
  }

  // ---- SW keepalive / connection watchdog ----------------------------------
  // Chrome suspends the SW after ~30s idle; with a visible tab the loop's
  // waits are local timers, so the SW can die mid-run (2026-08-30 Kansas
  // City: leads froze, Stop became a no-op, messages dropped silently). A
  // PING/PONG round trip every pingIntervalMs keeps the worker alive in
  // both visible and hidden tabs (gmSleep delegates to the SW when hidden)
  // and detects a lost connection loudly.
  var pingSeq = 0;
  var lastPongTs = 0;
  var pingWarned = false;
  function pingLoop() {
    if (!running) return;
    if (lastPongTs && Date.now() - lastPongTs > cfg.pingIntervalMs * 3 && !pingWarned) {
      pingWarned = true;
      console.warn('[gmle] service worker not responding — connection may be lost; extraction continues');
      GMLE.post(GMLE.MSG.ERROR, {
        message: 'Background connection lost — extraction continues, but Stop/Export may not work until the page is reloaded.'
      });
    }
    GMLE.post(GMLE.MSG.PING, { seq: ++pingSeq });
    gmSleep(cfg.pingIntervalMs).then(pingLoop);
  }

  function loop() {
    if (!running) return;

    if (captchaPaused) {
      if (!detectCaptcha()) {
        captchaPaused = false;
        GMLE.post(GMLE.MSG.RESUMED, { jobId: jobId });
      } else {
        gmSleep(cfg.captchaPollMs).then(loop);
        return;
      }
    }
    if (detectCaptcha()) {
      captchaPaused = true;
      GMLE.post(GMLE.MSG.CAPTCHA, { jobId: jobId });
      gmSleep(cfg.captchaPollMs).then(loop);
      return;
    }

    var prev = feedMetrics();
    var leads = [];
    try {
      leads = extractAll();
    } catch (e) {
      console.error('[content] extractAll threw:', e);
    }
    if (leads.length) {
      GMLE.post(GMLE.MSG.LEADS_DISCOVERED, { jobId: jobId, leads: leads });
    }

    // Single-flight wait: hold until the next page actually lands (or the
    // budget expires). A "dead" cycle = no new leads AND no feed growth.
    // At the bottom / with a spinner up, the next page is in flight — use a
    // much longer budget instead of concluding the feed is dead.
    var patient = feedSpinner() || atBottom();
    var budget = patient
      ? randBetween(cfg.scroll.bottomWaitMinMs, cfg.scroll.bottomWaitMaxMs)
      : randBetween(cfg.scroll.changeWaitMinMs, cfg.scroll.changeWaitMaxMs);
    waitForFeedChange(prev, budget).then(function (res) {
      if (!running) return;
      lastWaitMs = res.waitedMs;
      waitDone(res);
    });

    function waitDone(res) {
      loopCount++;
      if (loopCount % 3 === 0) GMLE.post(GMLE.MSG.DIAG, diag());

      // Feed replaced/removed (user opened a place, changed filters, etc.):
      // wait for it to come back instead of counting dead cycles — user
      // interaction must not end the job. Bounded by the SW idle watchdog.
      if (!document.querySelector(GMLE.selectors.feed)) {
        GMLE.post(GMLE.MSG.DIAG, Object.assign({ reason: 'feed-lost-waiting' }, diag()));
        gmSleep(2000).then(loop);
        return;
      }

      // Spinner visible = page in flight, not a dead feed. Don't count dead
      // cycles while it's up (unless it hangs for loadingGiveUpMs total),
      // and don't end the job while it's loading (2026-08-30 run).
      var spin = feedSpinner();
      if (res.changed || leads.length) {
        noAnchorStreak = 0;
        loadingMs = 0;
        loadingDiag = false;
      } else if (spin) {
        loadingMs += res.waitedMs;
        if (!loadingDiag) {
          loadingDiag = true;
          GMLE.post(GMLE.MSG.DIAG, Object.assign({ reason: 'feed-loading-wait', loadingMs: Math.round(loadingMs) }, diag()));
        }
        if (loadingMs >= cfg.scroll.loadingGiveUpMs) { noAnchorStreak++; loadingMs = 0; }
      } else {
        noAnchorStreak++;
        loadingMs = 0;
        loadingDiag = false;
      }

      if (detectEnd()) {
        endOfFeed('end');
        return;
      }
      if (noAnchorStreak >= cfg.scroll.maxConsecutiveNoNew) {
        GMLE.post(GMLE.MSG.DIAG, Object.assign({ reason: 'no-anchors-found' }, diag()));
        endOfFeed('no-results');
        return;
      }

      var proceed = function () {
        if (!running) return;
        // Don't scroll while the feed is loading a page — the next page
        // lands at the bottom we're already at. Stalled growth: jump
        // straight to the pagination trigger at the bottom.
        if (!feedSpinner() && document.querySelector(GMLE.selectors.feed)) {
          scrollFeedStep(noAnchorStreak > 0);
        }
        var delay = randBetween(cfg.scroll.minDelayMs, cfg.scroll.maxDelayMs);
        cyclesUntilPause--;
        if (cyclesUntilPause <= 0) {
          // occasional "reading pause" — irregular, human-like
          delay += randBetween(cfg.scroll.readPauseMinMs, cfg.scroll.readPauseMaxMs);
          cyclesUntilPause = Math.round(randBetween(cfg.scroll.readPauseEveryMin, cfg.scroll.readPauseEveryMax));
        }
        gmSleep(delay).then(loop);
      };

      // One cooldown per run: throttled feeds often resume after a pause.
      if (noAnchorStreak >= cfg.scroll.stallCooldownAfter && !cooldownUsed) {
        cooldownUsed = true;
        GMLE.post(GMLE.MSG.DIAG, Object.assign({ reason: 'stall-cooldown' }, diag()));
        gmSleep(cfg.scroll.stallCooldownMs).then(proceed);
        return;
      }
      proceed();
    }
  }

  GMLE.onMessage(function (msg) {
    var type = msg.type, payload = msg.payload || {};
    if (type === GMLE.MSG.START) {
      console.log('[content] START received jobId=' + payload.jobId);
      jobId = payload.jobId;
      jobFields = payload.fields && payload.fields.length ? payload.fields : GMLE.FIELDS;
      running = true;
      captchaPaused = false;
      seenLocal = new Set();
      leadIndex = {};
      visitQueue = [];
      visitTotal = 0;
      endReason = null;
      loadingMs = 0;
      loadingDiag = false;
      noAnchorStreak = 0;
      loopCount = 0;
      cooldownUsed = false;
      lastWaitMs = 0;
      cyclesUntilPause = Math.round(randBetween(cfg.scroll.readPauseEveryMin, cfg.scroll.readPauseEveryMax));
      pingSeq = 0;
      lastPongTs = Date.now();
      pingWarned = false;
      pingLoop();
      GMLE.post(GMLE.MSG.DIAG, diag());
      loop();
    } else if (type === GMLE.MSG.STOP) {
      running = false;
      visitQueue = []; // user asked to stop — drop pending detail visits
      GMLE.post(GMLE.MSG.DONE, { jobId: jobId, reason: 'stop' });
    } else if (type === GMLE.MSG.LOOP_TICK) {
      // SW-side sleep finished (hidden-tab scheduling) — release the waiter.
      var waiter = tickWaiters[payload.tickId];
      if (waiter) { delete tickWaiters[payload.tickId]; waiter(); }
    } else if (type === GMLE.MSG.PONG) {
      // Keepalive reply: connection to the SW is alive.
      lastPongTs = Date.now();
      pingWarned = false;
    } else if (type === GMLE.MSG.CHECK_JOB) {
      // Liveness check from the SW: only confirm when this tab is genuinely
      // extracting that exact job — otherwise the SW abandons it as stale.
      if (running && payload.jobId === jobId) {
        GMLE.post(GMLE.MSG.JOB_ACK, { jobId: jobId });
      }
    }
  });

  if (isMaps()) {
    sendStatus();
    // Keep broadcasting Maps status while idle so the overlay UI can gate
    // the START button on a fresh search.
    setInterval(function () { if (!running) sendStatus(); }, 2500);
  }
})();

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
  // short of it (an earlier margin cap prevented loading entirely).
  function scrollFeedStep() {
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
    var target = (distance <= step || distance <= view * 1.5)
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
  function endOfFeed(reason) {
    if (!running) return;
    endReason = reason || 'end';
    buildVisitQueue();
    if (visitQueue.length) {
      GMLE.post(GMLE.MSG.DIAG, Object.assign({ reason: 'phase2-start', visits: visitQueue.length }, diag()));
      visitNext();
    } else {
      finishNow();
    }
  }

  function finishNow() {
    running = false;
    GMLE.post(GMLE.MSG.DONE, { jobId: jobId, reason: endReason || 'end' });
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
  // name appears, and/or button[data-item-id="address"] shows up.
  function normName(s) { return (s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

  function panelOpen(name) {
    var norm = normName(name);
    var mains = document.querySelectorAll('div[role="main"][aria-label]');
    for (var i = 0; i < mains.length; i++) {
      var al = normName(mains[i].getAttribute('aria-label'));
      if (al && norm && (al === norm || al.indexOf(norm) !== -1)) return true;
    }
    return !!document.querySelector('button[data-item-id="address"]');
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

  function waitForFeed(timeoutMs) {
    var start = Date.now();
    return new Promise(function (resolve) {
      function poll() {
        if (document.querySelector(GMLE.selectors.feed)) { resolve(true); return; }
        if (Date.now() - start >= timeoutMs) { resolve(false); return; }
        gmSleep(250).then(poll);
      }
      gmSleep(250).then(poll);
    });
  }

  // Scrape the open detail panel (hooks per the 2026-08-30 DOM capture; aria/
  // role/data-item-id only — never minified class names, D-004).
  function scrapePanel() {
    var updates = {};
    var pbtn = document.querySelector('button[data-item-id^="phone"]');
    if (pbtn) {
      var ptext = (pbtn.innerText || '').trim() ||
        (pbtn.getAttribute('aria-label') || '').replace(/^phone\s*:\s*/i, '');
      var ph = GMLE.extractors._phoneFromText(ptext);
      if (ph) updates.phone = ph;
    }
    var wlink = document.querySelector('a[data-item-id^="authority"]');
    if (wlink && /^https?:/i.test(wlink.href || '')) updates.website = wlink.href;
    var abtn = document.querySelector('button[data-item-id="address"]');
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
          closePanelAndContinue(lead, {});
          return;
        }
        var updates = scrapePanel();
        if (updates.phone || updates.website || updates.address) {
          GMLE.post(GMLE.MSG.LEADS_ENRICHED, { jobId: jobId, fp: GMLE.fingerprint(lead), updates: updates });
        }
        closePanelAndContinue(lead, updates);
      });
    });
  }

  function closePanelAndContinue(lead, updates) {
    visitQueue.shift();
    var closeBtn = document.querySelector('button[aria-label="Close"]');
    if (closeBtn) closeBtn.click();
    // Wait for the feed to return (panel close restores it) before the next
    // visit — same feed-lost waiting the scroll loop relies on.
    waitForFeed(cfg.visit.feedReturnTimeoutMs).then(function () {
      if (!running) return;
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
    });
  }

  function afterVisit() {
    gmSleep(randBetween(cfg.visit.delayMinMs, cfg.visit.delayMaxMs)).then(visitNext);
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
    var budget = randBetween(cfg.scroll.changeWaitMinMs, cfg.scroll.changeWaitMaxMs);
    waitForFeedChange(prev, budget).then(function (res) {
      if (!running) return;
      lastWaitMs = res.waitedMs;
      if (res.changed || leads.length) noAnchorStreak = 0;
      else noAnchorStreak++;
      waitDone();
    });

    function waitDone() {
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
        if (document.querySelector(GMLE.selectors.feed)) scrollFeedStep();
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
      noAnchorStreak = 0;
      loopCount = 0;
      cooldownUsed = false;
      lastWaitMs = 0;
      cyclesUntilPause = Math.round(randBetween(cfg.scroll.readPauseEveryMin, cfg.scroll.readPauseEveryMax));
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

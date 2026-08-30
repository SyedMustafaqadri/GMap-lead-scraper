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
  var phoneQueue = [];
  var phoneFetching = false;
  var detailFetchBlocked = false;

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
      var f = GMLE.fingerprint(lead);
      if (seenLocal.has(f)) continue;
      seenLocal.add(f);
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

  // ---- detail-page enrichment (phone/website) ------------------------------
  // The feed card often does not render the phone (layout-dependent), so we
  // fetch each place's detail page (same-origin) and pull phone + website
  // from its HTML. The queue drains in parallel with scrolling, ~1 fetch/s.

  function queueDetailFetch(leads) {
    if (detailFetchBlocked) return;
    var wantPhone = jobFields.some(function (f) { return f.key === 'phone'; });
    var wantSite = jobFields.some(function (f) { return f.key === 'email'; });
    if (!wantPhone && !wantSite) return;
    leads.forEach(function (l) {
      if (!l.mapsUrl) return;
      if ((wantPhone && !l.phone) || (wantSite && !l.website)) phoneQueue.push(l);
    });
    drainDetailQueue();
  }

  function drainDetailQueue() {
    if (phoneFetching || !phoneQueue.length || detailFetchBlocked) return;
    phoneFetching = true;
    var lead = phoneQueue.shift();
    fetchDetail(lead.mapsUrl).then(function (res) {
      var updates = {};
      if (!lead.phone && res.phone) updates.phone = res.phone;
      if (!lead.website && res.website) updates.website = res.website;
      if (updates.phone || updates.website) {
        GMLE.post(GMLE.MSG.LEADS_ENRICHED, { jobId: jobId, fp: GMLE.fingerprint(lead), updates: updates });
      }
      phoneFetching = false;
      if (phoneQueue.length) gmSleep(randBetween(250, 600)).then(drainDetailQueue);
    });
  }

  function fetchDetail(url) {
    return fetch(url).then(function (r) { return r.text(); }).then(function (html) {
      if (/unusual traffic|not a robot|our systems have detected/i.test(html)) {
        detailFetchBlocked = true;
        phoneQueue.length = 0;
        GMLE.post(GMLE.MSG.DIAG, Object.assign({ reason: 'detail-fetch-blocked' }, diag()));
        return {};
      }
      return {
        phone: GMLE.extractors.phoneFromHtml(html),
        website: GMLE.extractors.websiteFromHtml(html)
      };
    }).catch(function () { return {}; });
  }

  // Post DONE only once the detail queue has drained, so phones fetched for
  // the last batches make it into the export.
  function finishJobLocal(reason) {
    var check = function () {
      if (!running) return; // STOP arrived — its own DONE already fired
      if (phoneQueue.length || phoneFetching) { gmSleep(500).then(check); return; }
      running = false;
      GMLE.post(GMLE.MSG.DONE, { jobId: jobId, reason: reason });
    };
    check();
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
      queueDetailFetch(leads);
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
        finishJobLocal('end');
        return;
      }
      if (noAnchorStreak >= cfg.scroll.maxConsecutiveNoNew) {
        GMLE.post(GMLE.MSG.DIAG, Object.assign({ reason: 'no-anchors-found' }, diag()));
        finishJobLocal('no-results');
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
      noAnchorStreak = 0;
      loopCount = 0;
      cooldownUsed = false;
      lastWaitMs = 0;
      phoneQueue.length = 0;
      phoneFetching = false;
      detailFetchBlocked = false;
      cyclesUntilPause = Math.round(randBetween(cfg.scroll.readPauseEveryMin, cfg.scroll.readPauseEveryMax));
      GMLE.post(GMLE.MSG.DIAG, diag());
      loop();
    } else if (type === GMLE.MSG.STOP) {
      running = false;
      phoneQueue.length = 0; // user asked to stop — drop pending detail fetches
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

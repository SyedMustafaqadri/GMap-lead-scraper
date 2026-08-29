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

  function randBetween(min, max) {
    return min + Math.random() * (max - min);
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
        setTimeout(poll, cfg.scroll.changeWaitPollMs);
      }
      setTimeout(poll, cfg.scroll.changeWaitPollMs);
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
    if (fed.scrollTo) fed.scrollTo({ top: target, behavior: 'smooth' });
    else fed.scrollTop = target;
  }

  function loop() {
    if (!running) return;

    if (captchaPaused) {
      if (!detectCaptcha()) {
        captchaPaused = false;
        GMLE.post(GMLE.MSG.RESUMED, { jobId: jobId });
      } else {
        setTimeout(loop, cfg.captchaPollMs);
        return;
      }
    }
    if (detectCaptcha()) {
      captchaPaused = true;
      GMLE.post(GMLE.MSG.CAPTCHA, { jobId: jobId });
      setTimeout(loop, cfg.captchaPollMs);
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

      if (detectEnd()) {
        GMLE.post(GMLE.MSG.DONE, { jobId: jobId, reason: 'end' });
        running = false;
        return;
      }
      if (noAnchorStreak >= cfg.scroll.maxConsecutiveNoNew) {
        GMLE.post(GMLE.MSG.DIAG, Object.assign({ reason: 'no-anchors-found' }, diag()));
        GMLE.post(GMLE.MSG.DONE, { jobId: jobId, reason: 'no-results' });
        running = false;
        return;
      }

      var proceed = function () {
        if (!running) return;
        scrollFeedStep();
        var delay = randBetween(cfg.scroll.minDelayMs, cfg.scroll.maxDelayMs);
        cyclesUntilPause--;
        if (cyclesUntilPause <= 0) {
          // occasional "reading pause" — irregular, human-like
          delay += randBetween(cfg.scroll.readPauseMinMs, cfg.scroll.readPauseMaxMs);
          cyclesUntilPause = Math.round(randBetween(cfg.scroll.readPauseEveryMin, cfg.scroll.readPauseEveryMax));
        }
        setTimeout(loop, delay);
      };

      // One cooldown per run: throttled feeds often resume after a pause.
      if (noAnchorStreak >= cfg.scroll.stallCooldownAfter && !cooldownUsed) {
        cooldownUsed = true;
        GMLE.post(GMLE.MSG.DIAG, Object.assign({ reason: 'stall-cooldown' }, diag()));
        setTimeout(proceed, cfg.scroll.stallCooldownMs);
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
      running = true;
      captchaPaused = false;
      seenLocal = new Set();
      noAnchorStreak = 0;
      loopCount = 0;
      cooldownUsed = false;
      lastWaitMs = 0;
      cyclesUntilPause = Math.round(randBetween(cfg.scroll.readPauseEveryMin, cfg.scroll.readPauseEveryMax));
      GMLE.post(GMLE.MSG.DIAG, diag());
      loop();
    } else if (type === GMLE.MSG.STOP) {
      running = false;
      GMLE.post(GMLE.MSG.DONE, { jobId: jobId, reason: 'stop' });
    }
  });

  if (isMaps()) {
    sendStatus();
    // Keep broadcasting Maps status while idle so the overlay UI can gate
    // the START button on a fresh search.
    setInterval(function () { if (!running) sendStatus(); }, 2500);
  }
})();

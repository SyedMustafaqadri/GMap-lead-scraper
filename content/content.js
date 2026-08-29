(function () {
  if (self.GMLE.__contentLoaded) return; // guard against re-injection double loops
  self.GMLE.__contentLoaded = true;

  var cfg = GMLE.config;
  var running = false;
  var jobId = null;
  var captchaPaused = false;
  var seenLocal = new Set();

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
    return {
      jobId: jobId,
      isMaps: isMaps(),
      feed: !!getFeed(),
      anchorsPlace: countAnchors(),
      totalAnchors: document.querySelectorAll('a[href^="http"]').length,
      hrefSample: sample,
      href: location.href.slice(0, 120)
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

  function scrollFeed() {
    var fed = document.querySelector(GMLE.selectors.feed);
    if (fed) {
      fed.scrollTop = fed.scrollHeight;
      if (fed.scrollBy) fed.scrollBy(0, 800);
    }
    var root = getFeed();
    if (root && root !== fed) root.scrollTop = root.scrollHeight;
    if (window.scrollBy) window.scrollBy(0, 600);
  }

  var noAnchorStreak = 0;
  var loopCount = 0;

  function loop() {
    if (!running) return;
    console.log('[content] loop#' + loopCount + ' running=' + running);

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

    var leads = [];
    try {
      leads = extractAll();
    } catch (e) {
      console.error('[content] extractAll threw:', e);
    }
    console.log('[content] loop#' + loopCount + ' anchors=' + countAnchors() + ' leads=' + leads.length + ' seen=' + seenLocal.size);
    if (leads.length) {
      noAnchorStreak = 0;
      GMLE.post(GMLE.MSG.LEADS_DISCOVERED, { jobId: jobId, leads: leads });
    } else {
      noAnchorStreak++;
    }

    loopCount++;
    if (loopCount % 3 === 0) GMLE.post(GMLE.MSG.DIAG, diag());

    if (detectEnd()) {
      GMLE.post(GMLE.MSG.DONE, { jobId: jobId, reason: 'end' });
      running = false;
      return;
    }
    if (noAnchorStreak >= 6) {
      GMLE.post(GMLE.MSG.DIAG, Object.assign({ reason: 'no-anchors-found' }, diag()));
      GMLE.post(GMLE.MSG.DONE, { jobId: jobId, reason: 'no-results' });
      running = false;
      return;
    }

    scrollFeed();
    setTimeout(loop, cfg.scroll.afterScrollMs);
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
      GMLE.post(GMLE.MSG.DIAG, diag());
      loop();
    } else if (type === GMLE.MSG.STOP) {
      running = false;
      GMLE.post(GMLE.MSG.DONE, { jobId: jobId, reason: 'stop' });
    }
  });

  if (isMaps()) {
    sendStatus();
    setInterval(function () { if (!running) sendStatus(); }, 2500);
  }
})();

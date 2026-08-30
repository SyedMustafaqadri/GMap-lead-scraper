self.GMLE = self.GMLE || {};

GMLE.MSG = {
  MAPS_STATUS: 'MAPS_STATUS',
  START_EXTRACTION: 'START_EXTRACTION',
  START: 'START',
  STOP: 'STOP',
  // Target reached: stop Phase 1 collecting but let Phase 2 enrich the
  // collected queue before DONE (a hard STOP skips phones/websites entirely).
  FINISH: 'FINISH',
  LEADS_DISCOVERED: 'LEADS_DISCOVERED',
  LEADS_ENRICHED: 'LEADS_ENRICHED',
  DONE: 'DONE',
  CAPTCHA: 'CAPTCHA',
  RESUMED: 'RESUMED',
  STATUS_UPDATE: 'STATUS_UPDATE',
  STATE_CHANGED: 'STATE_CHANGED',
  REQUEST_EXPORT: 'REQUEST_EXPORT',
  DIAG: 'DIAG',
  ERROR: 'ERROR',
  OVERLAY_TOGGLE: 'OVERLAY_TOGGLE',
  REQUEST_STATUS: 'REQUEST_STATUS',
  DEBUG_GET_STATE: 'DEBUG_GET_STATE',
  DEBUG_STATE: 'DEBUG_STATE',
  DEBUG_EVENTS: 'DEBUG_EVENTS',
  DEBUG_CLEAR: 'DEBUG_CLEAR',
  // Hidden-tab scheduling: content delegates its loop timers to the SW
  // (Chrome throttles hidden-tab timers to ~1/min; SW->tab messages are
  // delivered immediately). See gmSleep() in content.js.
  SCHEDULE_TICK: 'SCHEDULE_TICK',
  LOOP_TICK: 'LOOP_TICK',
  // Stale-job liveness check: on SW wake, the stored currentJobId may belong
  // to a dead session (browser was closed mid-run). The SW asks the job's
  // tab; only a content script with an actually-running loop answers.
  CHECK_JOB: 'CHECK_JOB',
  JOB_ACK: 'JOB_ACK',
  // Keepalive round trip: content pings the running SW every ~20s so it
  // never suspends mid-run (a suspended SW silently ate every message on
  // the 2026-08-30 Kansas City run — leads froze, Stop became a no-op).
  // Also doubles as a connection watchdog on the content side.
  PING: 'PING',
  PONG: 'PONG'
};

// Context tag for trace/debug: 'sw' in the service worker, 'content' in
// content scripts (overlay.js overrides this to 'overlay').
GMLE.CONTEXT = (typeof importScripts === 'function') ? 'sw' : 'content';

// Optional trace tap, installed by modules/debug.js. Called for every
// message sent or received in this context. Never throws.
GMLE._traceTap = null;
GMLE._setTraceTap = function (fn) { GMLE._traceTap = fn; };
GMLE._trace = function (dir, type, payload) {
  if (GMLE._traceTap) {
    try { GMLE._traceTap(dir, type, payload); } catch (e) { /* tracing must never break messaging */ }
  }
};

GMLE.post = function (type, payload) {
  GMLE._trace('send', type, payload);
  try {
    var p = chrome.runtime.sendMessage({ type: type, payload: payload });
    if (p && p.catch) {
      p.catch(function (e) {
        // Never swallow silently: a suspended/dead SW must be visible in the
        // console (2026-08-30: messages were dropped without a trace).
        console.warn('[gmle] post ' + type + ' failed:', (e && e.message) || e);
      });
    }
    return p;
  } catch (e) {
    console.warn('[gmle] post ' + type + ' threw:', (e && e.message) || e);
    return Promise.resolve();
  }
};

GMLE.postToTab = function (tabId, type, payload) {
  GMLE._trace('send:tab', type, payload);
  try {
    var p = chrome.tabs.sendMessage(tabId, { type: type, payload: payload });
    if (p && p.catch) p.catch(function (e) { console.warn('GMLE.postToTab failed:', e && e.message); });
    return p;
  } catch (e) { return Promise.resolve(); }
};

GMLE.onMessage = function (handler) {
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    GMLE._trace('recv', msg && msg.type, msg && msg.payload);
    try { handler(msg, sender, sendResponse); } catch (e) { console.error('GMLE handler error:', e); }
    return false;
  });
};

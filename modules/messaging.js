self.GMLE = self.GMLE || {};

GMLE.MSG = {
  MAPS_STATUS: 'MAPS_STATUS',
  START_EXTRACTION: 'START_EXTRACTION',
  START: 'START',
  STOP: 'STOP',
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
  DEBUG_CLEAR: 'DEBUG_CLEAR'
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
    if (p && p.catch) p.catch(function () {});
    return p;
  } catch (e) { return Promise.resolve(); }
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

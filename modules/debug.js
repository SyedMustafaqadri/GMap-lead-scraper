self.GMLE = self.GMLE || {};

// Shared debug core: message-trace ring buffer + leveled log ring buffer.
// Loaded in all contexts, but the trace tap is only installed where
// GMLE.debug.installTap() is called (currently the service worker, which is
// the hub for all message traffic). Overlay UI consumes buffers via the
// DEBUG_* messages handled in background.js.
GMLE.debug = (function () {
  var cfg = (GMLE.config && GMLE.config.debug) || { eventBufferSize: 300, logBufferSize: 300 };

  var events = []; // {ts, ctx, dir, type, summary, payload}
  var logs = [];   // {ts, level, tag, msg}
  var listener = null;

  function push(arr, max, item) {
    arr.push(item);
    if (arr.length > max) arr.splice(0, arr.length - max);
  }

  // Shallow-ish clone for safe keeping/display: arrays truncated to 3 items,
  // strings capped, depth limited. Keeps lead arrays from bloating memory.
  function slim(value, depth) {
    if (depth > 2 || value == null) return value;
    if (typeof value === 'string') return value.length > 300 ? value.slice(0, 300) + '…' : value;
    if (Array.isArray(value)) {
      var out = value.slice(0, 3).map(function (v) { return slim(v, depth + 1); });
      if (value.length > 3) out.push('… +' + (value.length - 3) + ' more');
      return out;
    }
    if (typeof value === 'object') {
      var o = {};
      for (var k in value) { if (Object.prototype.hasOwnProperty.call(value, k)) o[k] = slim(value[k], depth + 1); }
      return o;
    }
    return value;
  }

  function summarize(payload) {
    if (payload == null) return '';
    if (Array.isArray(payload.leads)) return payload.leads.length + ' lead(s)';
    if (payload.state) return String(payload.state);
    if (payload.reason) return String(payload.reason);
    var s = JSON.stringify(slim(payload, 0));
    return s && s.length > 120 ? s.slice(0, 120) + '…' : (s || '');
  }

  function addEvent(dir, type, payload) {
    var evt = {
      ts: Date.now(),
      ctx: GMLE.CONTEXT,
      dir: dir,
      type: type,
      summary: summarize(payload),
      payload: slim(payload, 0)
    };
    push(events, cfg.eventBufferSize, evt);
    if (listener) {
      try { listener('event', evt); } catch (e) { /* listener must never break the hub */ }
    }
    return evt;
  }

  function log(level, tag, msg) {
    var entry = { ts: Date.now(), level: level, tag: tag || '', msg: String(msg) };
    push(logs, cfg.logBufferSize, entry);
    if (listener) {
      try { listener('log', entry); } catch (e) { /* listener must never break the hub */ }
    }
    if (level === 'warn' || level === 'error') {
      (level === 'error' ? console.error : console.warn)('[gmle:' + entry.tag + '] ' + entry.msg);
    }
    return entry;
  }

  function sinceTs(arr, sinceTsArg) {
    if (sinceTsArg == null) return arr.slice();
    return arr.filter(function (e) { return e.ts > sinceTsArg; });
  }

  return {
    log: log,
    addEvent: addEvent,
    installTap: function () {
      GMLE._setTraceTap(function (dir, type, payload) {
        // Skip debug + scheduler traffic so streaming never feeds back into
        // itself and the trace stays readable (scheduler ticks every ~300ms).
        if (!type || type.indexOf('DEBUG_') === 0 ||
            type === 'SCHEDULE_TICK' || type === 'LOOP_TICK') return;
        addEvent(dir, type, payload);
      });
    },
    // fn(kind, entry) where kind is 'event' | 'log'; used by the SW to stream
    // buffer activity to the overlay debug drawer.
    setListener: function (fn) { listener = fn; },
    getEvents: function (since) { return sinceTs(events, since); },
    getLogs: function (since) { return sinceTs(logs, since); },
    clearAll: function () { events.length = 0; logs.length = 0; },
    formatTs: function (ts) {
      var d = new Date(ts);
      var p = function (n, w) { return String(n).padStart(w || 2, '0'); };
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
    }
  };
})();

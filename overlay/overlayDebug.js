self.GMLE = self.GMLE || {};

// Developer debug drawer for the floating overlay. Mounted by overlay.js only
// when GMLE.DEV_MODE is true (flag in modules/config.js). Shows three tabs fed
// by the DEBUG_* stream from the service worker: live state snapshot, message
// event trace, and leveled execution logs. The demo run also lives here.
// Guard: script re-injection (fallback path) must not replace an already
// mounted instance, which keeps the live drawer state in its closure.
if (!GMLE.debugUi) GMLE.debugUi = (function () {
  var cfg = (GMLE.config && GMLE.config.debug) || {};
  var MAX_EVENTS = cfg.eventBufferSize || 300;
  var MAX_LOGS = cfg.logBufferSize || 300;

  var ui = null;
  var els = {};
  var snap = null;        // last DEBUG_STATE snapshot
  var events = [];        // local copies, oldest first
  var logs = [];
  var expandedTs = null;  // ts of the event whose payload is expanded
  var tab = 'state';
  var paused = false;
  var evFilter = '';
  var logLevel = 'all';
  var logFilter = '';

  function fmtTs(ts) {
    if (GMLE.debug && GMLE.debug.formatTs) return GMLE.debug.formatTs(ts);
    var d = new Date(ts);
    return d.toLocaleTimeString();
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function pushCapped(arr, max, entry) {
    arr.push(entry);
    if (arr.length > max) arr.splice(0, arr.length - max);
  }

  function dirInfo(dir) {
    if (dir === 'send') return { key: 'send', label: '→ out' };
    if (dir === 'send:tab') return { key: 'sendtab', label: '→ tab' };
    return { key: 'recv', label: '← in' };
  }

  function postStream(enable) {
    GMLE.post(GMLE.MSG.DEBUG_GET_STATE, { stream: !!enable });
  }

  // ---- rendering -----------------------------------------------------------

  function render() {
    if (!ui || ui.hidden) return;
    renderTabs();
    renderToolbar();
    renderView();
  }

  function renderTabs() {
    ['state', 'events', 'log'].forEach(function (t) {
      els.tabs[t].classList.toggle('active', tab === t);
    });
  }

  function clearNode(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function copyToClipboard(text, btn) {
    var done = function () {
      var old = btn.textContent;
      btn.textContent = 'Copied ✓';
      setTimeout(function () { btn.textContent = old; }, 900);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function miniBtn(label, onClick) {
    var b = el('button', 'gm-mini-btn', label);
    b.addEventListener('click', onClick);
    return b;
  }

  function renderToolbar() {
    clearNode(els.toolbar);
    if (tab === 'state') {
      els.toolbar.appendChild(miniBtn('Refresh', function () { postStream(true); }));
      els.toolbar.appendChild(miniBtn('Copy', function () {
        copyToClipboard(snap ? JSON.stringify(snap, null, 2) : '{}', this);
      }));
      els.toolbar.appendChild(miniBtn('Dump to console', function () {
        console.log('[GMLE debug] snapshot', snap);
      }));
    } else if (tab === 'events') {
      var f = el('input', 'gm-filter');
      f.placeholder = 'Filter by type…';
      f.value = evFilter;
      f.addEventListener('input', function () { evFilter = f.value.trim().toLowerCase(); renderView(); });
      els.toolbar.appendChild(f);
      var p = miniBtn(paused ? 'Resume' : 'Pause', function () {
        paused = !paused;
        renderToolbar();
      });
      p.classList.toggle('active', paused);
      els.toolbar.appendChild(p);
      els.toolbar.appendChild(miniBtn('Copy', function () { copyEvents(this); }));
      els.toolbar.appendChild(miniBtn('Clear', function () {
        events.length = 0;
        expandedTs = null;
        GMLE.post(GMLE.MSG.DEBUG_CLEAR, {});
        renderView();
      }));
    } else {
      var sel = document.createElement('select');
      sel.className = 'gm-filter';
      sel.style.flex = '0 0 auto';
      ['all', 'info', 'warn', 'error'].forEach(function (lv) {
        var o = el('option', null, lv === 'all' ? 'All levels' : lv);
        o.value = lv;
        if (lv === logLevel) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () { logLevel = sel.value; renderView(); });
      els.toolbar.appendChild(sel);
      var f2 = el('input', 'gm-filter');
      f2.placeholder = 'Filter…';
      f2.value = logFilter;
      f2.addEventListener('input', function () { logFilter = f2.value.trim().toLowerCase(); renderView(); });
      els.toolbar.appendChild(f2);
      els.toolbar.appendChild(miniBtn('Copy all', function () { copyLogs(f2); }));
      els.toolbar.appendChild(miniBtn('Clear', function () {
        logs.length = 0;
        GMLE.post(GMLE.MSG.DEBUG_CLEAR, {});
        renderView();
      }));
    }
  }

  // Copies the visible (filter-respecting) event trace, including payload
  // content, for pasting into reports or bug descriptions.
  function copyEvents(btn) {
    var lines = [];
    for (var i = 0; i < events.length; i++) {
      var evt = events[i];
      if (evFilter && evt.type.toLowerCase().indexOf(evFilter) === -1) continue;
      var d = dirInfo(evt.dir);
      lines.push('[' + fmtTs(evt.ts) + '] ' + d.label + ' ' + evt.type + (evt.summary ? '  ' + evt.summary : ''));
      if (evt.payload !== undefined && evt.payload !== null) {
        lines.push('    ' + JSON.stringify(evt.payload));
      }
    }
    copyToClipboard(lines.reverse().join('\n') || '(no events)', btn);
  }

  function copyLogs(filterInput) {
    var text = logs.slice().reverse().map(function (l) {
      return fmtTs(l.ts) + ' [' + l.level.toUpperCase() + (l.tag ? ' ' + l.tag : '') + '] ' + l.msg;
    }).join('\n');
    var done = function () {
      // brief visual confirmation
      filterInput.value = 'Copied ' + logs.length + ' lines';
      setTimeout(function () { filterInput.value = logFilter; }, 900);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* best effort */ }
    document.body.removeChild(ta);
  }

  function emptyNote(text) {
    els.view.appendChild(el('div', 'gm-debug-empty', text));
  }

  function renderView() {
    if (!ui || ui.hidden) return;
    clearNode(els.view);
    if (tab === 'state') return renderState();
    if (tab === 'events') return renderEvents();
    return renderLogs();
  }

  function renderState() {
    if (!snap) { emptyNote('No snapshot yet — press Refresh.'); return; }
    var pre = el('pre', 'gm-state-pre', JSON.stringify(snap, null, 2));
    els.view.appendChild(pre);
  }

  function renderEvents() {
    if (!events.length) { emptyNote('No events captured yet. Start an extraction and watch traffic here.'); return; }
    for (var i = events.length - 1; i >= 0; i--) {
      var evt = events[i];
      if (evFilter && evt.type.toLowerCase().indexOf(evFilter) === -1) continue;
      var d = dirInfo(evt.dir);
      var row = el('div', 'gm-ev-row');
      row.appendChild(el('span', 'gm-ev-time', fmtTs(evt.ts) + ' '));
      row.appendChild(el('span', 'gm-ev-dir dir-' + d.key, d.label + ' '));
      row.appendChild(el('span', 'gm-ev-type', evt.type));
      if (evt.summary) row.appendChild(el('span', 'gm-ev-summary', '  ' + evt.summary));
      if (expandedTs === evt.ts) {
        var pre = el('pre', 'gm-ev-payload', JSON.stringify(evt.payload, null, 1));
        row.appendChild(pre);
      }
      row.addEventListener('click', function (ts) {
        return function () { expandedTs = expandedTs === ts ? null : ts; renderView(); };
      }(evt.ts));
      els.view.appendChild(row);
    }
  }

  function renderLogs() {
    if (!logs.length) { emptyNote('No log entries yet.'); return; }
    for (var i = logs.length - 1; i >= 0; i--) {
      var l = logs[i];
      if (logLevel !== 'all' && l.level !== logLevel) continue;
      if (logFilter && (l.msg + ' ' + l.tag).toLowerCase().indexOf(logFilter) === -1) continue;
      var row = el('div', 'gm-log-row');
      row.appendChild(el('span', 'gm-ev-time', fmtTs(l.ts) + ' '));
      row.appendChild(el('span', 'lv lv-' + l.level, '[' + l.level.toUpperCase() + (l.tag ? ' ' + l.tag : '') + '] '));
      row.appendChild(document.createTextNode(l.msg));
      els.view.appendChild(row);
    }
  }

  // ---- public API ----------------------------------------------------------

  return {
    mount: function (root, api) {
      if (ui) return;
      ui = root;

      var bar = el('div', 'gm-debug-toolbar');
      bar.appendChild(miniBtn('Demo run', function () {
        var sel = api.getSelection();
        GMLE.post(GMLE.MSG.START_EXTRACTION, {
          demo: true,
          tabId: -1,
          targetLeads: sel.targetLeads || 60,
          fields: sel.fields,
          search: 'demo'
        });
      }));
      ui.appendChild(bar);

      els.tabs = {};
      var tabs = el('div', 'gm-debug-tabs');
      var labels = { state: 'State', events: 'Events', log: 'Log' };
      ['state', 'events', 'log'].forEach(function (t) {
        var b = el('button', 'gm-debug-tab', labels[t]);
        b.addEventListener('click', function () { tab = t; render(); });
        els.tabs[t] = b;
        tabs.appendChild(b);
      });
      ui.appendChild(tabs);

      els.toolbar = el('div', 'gm-debug-toolbar');
      ui.appendChild(els.toolbar);

      els.view = el('div', 'gm-debug-view');
      ui.appendChild(els.view);

      render();
    },

    setOpen: function (open) {
      if (!ui) return;
      ui.hidden = !open;
      postStream(open); // stream debug traffic while the drawer is visible
      if (open) render();
    },

    isOpen: function () { return !!ui && !ui.hidden; },

    // Called by overlay.js for DEBUG_STATE / DEBUG_EVENTS broadcasts.
    onMessage: function (type, payload) {
      if (type === GMLE.MSG.DEBUG_STATE) {
        snap = payload;
        if (tab === 'state') renderView();
        return;
      }
      if (type === GMLE.MSG.DEBUG_EVENTS) {
        if (paused) return;
        (payload.events || []).forEach(function (e) { pushCapped(events, MAX_EVENTS, e); });
        (payload.logs || []).forEach(function (l) { pushCapped(logs, MAX_LOGS, l); });
        if (tab === 'events' || tab === 'log') renderView();
      }
    }
  };
})();

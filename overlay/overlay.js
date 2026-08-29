self.GMLE = self.GMLE || {};

// Floating overlay UI (V2) — replaces the old side panel.
//
// Dormant content script: registers a listener at page load but creates no
// DOM. The first OVERLAY_TOGGLE (from the toolbar click handler in
// background.js) builds a shadow-DOM isolated floating panel fixed to the
// top-right of the viewport, collapsible into a small round trigger button.
// All dynamic data is rendered via textContent; markup below is static.
if (!GMLE.__overlayLoaded) {
  GMLE.__overlayLoaded = true;
  GMLE.CONTEXT = 'overlay';

  (function () {
    var States = GMLE.States;
    var RUNNING_STATES = [States.INITIALIZING, States.RUNNING, States.PAUSED,
      States.CAPTCHA, States.STOPPING, States.COMPLETING];
    var PILL_LABELS = {
      IDLE: 'Idle',
      INITIALIZING: 'Starting',
      RUNNING: 'Running',
      PAUSED: 'Paused',
      CAPTCHA: 'Captcha',
      STOPPING: 'Stopping',
      COMPLETING: 'Finishing',
      COMPLETED: 'Done',
      ERROR: 'Error'
    };

    // ---- state ----
    var mapsReady = false;
    var lastSearch = '';
    var currentJobId = null;
    var state = States.IDLE;
    var status = null;      // last STATUS_UPDATE payload
    var settings = { targetLeads: 500, fields: null, settingsOpen: false, debugOpen: false };
    var debugMounted = false;
    var ui = null;

    GMLE.storage.getSettings().then(function (s) {
      if (!s) return;
      if (typeof s.targetLeads === 'number') settings.targetLeads = s.targetLeads;
      if (s.fields && typeof s.fields === 'object') settings.fields = s.fields;
      settings.settingsOpen = !!s.settingsOpen;
      settings.debugOpen = !!s.debugOpen;
      applySettings();
      render();
    });

    function persistSettings() { GMLE.storage.saveSettings(settings); }

    function isRunning() { return RUNNING_STATES.indexOf(state) !== -1; }

    // ---- static markup (no untrusted data; rendered values use textContent) ----
    var MARKUP =
      '<div class="gm-trigger" title="Toggle Maps Leads panel">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">' +
          '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="#fff"/>' +
          '<circle cx="12" cy="9" r="2.7" fill="#1a73e8"/>' +
        '</svg>' +
      '</div>' +
      '<div class="gm-panel" hidden>' +
        '<header class="gm-header">' +
          '<span class="gm-logo"></span>' +
          '<h1 class="gm-title">Maps Leads</h1>' +
          '<span class="gm-pill" data-state="IDLE">Idle</span>' +
          '<button class="gm-icon-btn gm-debug-btn" title="Developer debug" hidden>' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
              '<path d="M20 8h-2.81a5.985 5.985 0 0 0-1.82-1.96L17 4.41 15.59 3l-2.17 2.17a6.002 6.002 0 0 0-2.83 0L8.41 3 7 4.41l1.62 1.63A5.985 5.985 0 0 0 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8z"/>' +
            '</svg>' +
          '</button>' +
          '<button class="gm-icon-btn gm-collapse-btn" title="Minimize panel">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>' +
          '</button>' +
        '</header>' +
        '<div class="gm-body">' +
          '<div class="gm-card gm-status">' +
            '<div class="gm-maps-line">Detecting Google Maps…</div>' +
            '<div class="gm-search-line"></div>' +
            '<div class="gm-error-line" hidden></div>' +
          '</div>' +
          '<button class="gm-primary">Start extraction</button>' +
          '<div class="gm-card gm-progress" hidden>' +
            '<div class="gm-metrics">' +
              '<div class="gm-metric leads"><span class="val gm-leadval">0</span><span class="lbl">Leads</span></div>' +
              '<div class="gm-metric"><span class="val gm-dup">0</span><span class="lbl">Duplicates</span></div>' +
              '<div class="gm-metric"><span class="val gm-enrich">0 / 0</span><span class="lbl">Enriched</span></div>' +
            '</div>' +
            '<div class="gm-current"></div>' +
          '</div>' +
          '<button class="gm-export" hidden>Export XLSX</button>' +
          '<section class="gm-settings">' +
            '<button class="gm-settings-toggle">' +
              '<span>Extraction settings</span>' +
              '<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
            '</button>' +
            '<div class="gm-settings-body" hidden>' +
              '<label class="gm-row">Target leads' +
                '<input class="gm-target" type="number" min="0" step="10" value="500">' +
              '</label>' +
              '<div class="gm-fields"></div>' +
            '</div>' +
          '</section>' +
          '<div class="gm-debug-root" hidden></div>' +
        '</div>' +
      '</div>';

    // ---- DOM construction (deferred until first toggle) ----
    function buildUi() {
      var host = document.createElement('div');
      host.id = 'gmle-overlay-host';
      (document.documentElement || document.body).appendChild(host);
      var shadow = host.attachShadow({ mode: 'open' });

      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL('overlay/overlay.css');
      shadow.appendChild(link);

      var tpl = document.createElement('template');
      tpl.innerHTML = MARKUP;
      shadow.appendChild(tpl.content);

      var $ = function (sel) { return shadow.querySelector(sel); };
      ui = {
        host: host,
        shadow: shadow,
        trigger: $('.gm-trigger'),
        panel: $('.gm-panel'),
        pill: $('.gm-pill'),
        debugBtn: $('.gm-debug-btn'),
        collapseBtn: $('.gm-collapse-btn'),
        mapsLine: $('.gm-maps-line'),
        searchLine: $('.gm-search-line'),
        errorLine: $('.gm-error-line'),
        primary: $('.gm-primary'),
        progress: $('.gm-progress'),
        mLeads: $('.gm-leadval'),
        mDups: $('.gm-dup'),
        mEnrich: $('.gm-enrich'),
        current: $('.gm-current'),
        exportBtn: $('.gm-export'),
        settingsToggle: $('.gm-settings-toggle'),
        settingsBody: $('.gm-settings-body'),
        target: $('.gm-target'),
        fieldsBox: $('.gm-fields'),
        debugRoot: $('.gm-debug-root')
      };

      buildFields();
      wire();
      mountDebug();
      applySettings();
      render();
    }

    function buildFields() {
      GMLE.FIELDS.forEach(function (f) {
        var label = document.createElement('label');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = f.key;
        cb.dataset.key = f.key;
        cb.checked = (settings.fields && (f.key in settings.fields))
          ? !!settings.fields[f.key]
          : !!f.def;
        label.appendChild(cb);
        label.appendChild(document.createTextNode(f.label));
        ui.fieldsBox.appendChild(label);
      });
    }

    function selectedFields() {
      var out = [];
      Array.prototype.forEach.call(ui.fieldsBox.querySelectorAll('input'), function (cb) {
        if (!cb.checked) return;
        for (var i = 0; i < GMLE.FIELDS.length; i++) {
          if (GMLE.FIELDS[i].key === cb.value) { out.push(GMLE.FIELDS[i]); break; }
        }
      });
      return out;
    }

    function wire() {
      ui.trigger.addEventListener('click', openPanel);
      ui.collapseBtn.addEventListener('click', closePanel);

      ui.primary.addEventListener('click', function () {
        if (isRunning()) {
          if (currentJobId) GMLE.post(GMLE.MSG.STOP, { jobId: currentJobId });
          return;
        }
        GMLE.post(GMLE.MSG.START_EXTRACTION, {
          targetLeads: parseInt(ui.target.value, 10) || 0,
          fields: selectedFields(),
          search: lastSearch
        });
      });

      ui.exportBtn.addEventListener('click', function () {
        if (currentJobId) GMLE.post(GMLE.MSG.REQUEST_EXPORT, { jobId: currentJobId });
      });

      ui.settingsToggle.addEventListener('click', function () {
        settings.settingsOpen = !settings.settingsOpen;
        ui.settingsBody.hidden = !settings.settingsOpen;
        ui.settingsToggle.classList.toggle('open', settings.settingsOpen);
        persistSettings();
      });

      ui.target.addEventListener('change', function () {
        settings.targetLeads = parseInt(ui.target.value, 10) || 0;
        persistSettings();
      });

      ui.fieldsBox.addEventListener('change', function () {
        var map = {};
        Array.prototype.forEach.call(ui.fieldsBox.querySelectorAll('input'), function (cb) {
          map[cb.dataset.key] = cb.checked;
        });
        settings.fields = map;
        persistSettings();
      });
    }

    function mountDebug() {
      if (!GMLE.DEV_MODE || debugMounted || !GMLE.debugUi) return;
      debugMounted = true;
      GMLE.debugUi.mount(ui.debugRoot, {
        getSelection: function () {
          return { targetLeads: parseInt(ui.target.value, 10) || 0, fields: selectedFields() };
        }
      });
      ui.debugBtn.hidden = false;
      ui.debugBtn.addEventListener('click', function () {
        var open = !GMLE.debugUi.isOpen();
        GMLE.debugUi.setOpen(open);
        ui.debugBtn.classList.toggle('active', open);
        settings.debugOpen = open;
        persistSettings();
      });
    }

    function applySettings() {
      if (!ui) return;
      ui.target.value = settings.targetLeads;
      if (settings.fields) {
        Array.prototype.forEach.call(ui.fieldsBox.querySelectorAll('input'), function (cb) {
          if (cb.dataset.key in settings.fields) cb.checked = !!settings.fields[cb.dataset.key];
        });
      }
      ui.settingsBody.hidden = !settings.settingsOpen;
      ui.settingsToggle.classList.toggle('open', settings.settingsOpen);
    }

    // ---- rendering ----
    function render() {
      if (!ui) return;
      ui.pill.textContent = PILL_LABELS[state] || state;
      ui.pill.dataset.state = state;

      if (isRunning()) {
        ui.primary.textContent = 'Stop extraction';
        ui.primary.classList.add('danger');
        ui.primary.disabled = false;
      } else {
        ui.primary.textContent = 'Start extraction';
        ui.primary.classList.remove('danger');
        ui.primary.disabled = !(mapsReady || GMLE.DEMO_MODE);
      }

      var hasLeads = !!(status && status.total > 0);
      ui.progress.hidden = !isRunning() && !hasLeads;
      ui.exportBtn.hidden = isRunning() || !hasLeads;

      if (status) {
        ui.mLeads.textContent = status.total + (status.target ? ' / ' + status.target : '');
        ui.mDups.textContent = status.duplicates || 0;
        ui.mEnrich.textContent = (status.enrichment ? status.enrichment.done : 0) +
          ' / ' + (status.enrichment ? status.enrichment.queued : 0);
        ui.current.textContent = status.lastLeadName ? 'Current: ' + status.lastLeadName : '';
      }
    }

    // ---- open / close / toggle ----
    function openPanel() {
      ui.trigger.hidden = true;
      ui.panel.hidden = false;
      // Rehydrate: ask the SW for current state + Maps status for this tab.
      GMLE.post(GMLE.MSG.REQUEST_STATUS, {});
      if (debugMounted && settings.debugOpen) {
        GMLE.debugUi.setOpen(true);
        ui.debugBtn.classList.add('active');
      }
    }

    function closePanel() {
      ui.panel.hidden = true;
      ui.trigger.hidden = false;
      if (debugMounted && GMLE.debugUi.isOpen()) {
        GMLE.debugUi.setOpen(false);
        ui.debugBtn.classList.remove('active');
      }
    }

    function toggle() {
      if (!ui) { buildUi(); openPanel(); return; }
      if (ui.panel.hidden) openPanel(); else closePanel();
    }

    // ---- messages ----
    GMLE.onMessage(function (msg) {
      var type = msg.type, p = msg.payload || {};
      if (type === GMLE.MSG.OVERLAY_TOGGLE) { toggle(); return; }
      if (!ui) return; // dormant
      if (type === GMLE.MSG.MAPS_STATUS) {
        mapsReady = !!p.ready;
        lastSearch = p.search || '';
        ui.mapsLine.textContent = mapsReady ? 'Google Maps ready' : 'Open & search Google Maps to begin';
        ui.mapsLine.classList.toggle('ok', mapsReady);
        ui.searchLine.textContent = lastSearch ? 'Search detected: ' + lastSearch : '';
        ui.errorLine.hidden = true;
        render();
      } else if (type === GMLE.MSG.STATE_CHANGED) {
        currentJobId = p.jobId;
        state = p.state || States.IDLE;
        ui.errorLine.hidden = true;
        render();
      } else if (type === GMLE.MSG.ERROR) {
        ui.errorLine.textContent = p.message || 'Unknown error';
        ui.errorLine.hidden = false;
      } else if (type === GMLE.MSG.STATUS_UPDATE) {
        currentJobId = p.jobId;
        status = p;
        state = p.state || state;
        render();
      } else if (debugMounted && GMLE.debugUi &&
                 (type === GMLE.MSG.DEBUG_STATE || type === GMLE.MSG.DEBUG_EVENTS)) {
        GMLE.debugUi.onMessage(type, p);
      }
    });

    // Tab close / hard navigation while running: stop the job (spec §40,
    // remapped to the overlay lifecycle — collapsing the panel does NOT stop).
    window.addEventListener('pagehide', function () {
      if (currentJobId && isRunning()) GMLE.post(GMLE.MSG.STOP, { jobId: currentJobId });
    });
  })();
}

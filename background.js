importScripts(
  'modules/config.js',
  'modules/messaging.js',
  'modules/debug.js',
  'modules/stateMachine.js',
  'modules/dedupe.js',
  'modules/storage.js',
  'modules/jobManager.js',
  'modules/enrichment.js',
  // Loaded at startup, NOT lazily: Chrome MV3 forbids importScripts after the
  // initial evaluation ("Cannot use importScripts after init"), which broke
  // every export when it was deferred to the request handler.
  'lib/xlsx.full.min.js',
  'modules/xlsxExport.js'
);

var currentJobId = null;
var mapsStatusByTab = {};

// --- Job restore (MV3 SWs die and restart; jobs live in memory) ------------
// Chrome may kill the service worker mid-run. On wake, rebuild the active
// job from IndexedDB so STOP, lead intake, and export keep working. Without
// this, stopJob() silently no-ops and leads hit "unknown job" after a
// restart.
var restorePromise = null;
var liveJobAcks = {}; // jobId -> callback, set while a CHECK_JOB is pending

// A restored job is only kept if its tab confirms an actually-running
// extraction loop (CHECK_JOB/JOB_ACK). Otherwise it's a stale job from a
// previous browser session: abandon it (clear pointer, tell the overlay
// Idle). Its checkpointed leads stay exportable via the storage fallback.
function ensureJobRestored(notifyTabId) {
  if (restorePromise) return restorePromise;
  restorePromise = GMLE.storage.getCurrentJobId().then(function (id) {
    if (!id || GMLE.jobManager.get(id)) return;
    return GMLE.storage.getJob(id).then(function (pj) {
      if (!pj) return;
      return new Promise(function (resolve) {
        var acked = false;
        liveJobAcks[id] = function () { acked = true; };
        if (pj.tabId != null) GMLE.postToTab(pj.tabId, GMLE.MSG.CHECK_JOB, { jobId: id });
        setTimeout(function () {
          delete liveJobAcks[id];
          if (!acked) {
            GMLE.jobManager.remove(id);
            GMLE.storage.setCurrentJobId(null);
            currentJobId = null;
            GMLE.debug.log('info', 'sw', 'abandoned stale job=' + id + ' (no live loop in tab)');
            if (notifyTabId != null) {
              GMLE.postToTab(notifyTabId, GMLE.MSG.STATE_CHANGED, { jobId: id, state: GMLE.States.IDLE, searchQuery: pj.searchQuery });
            }
            return resolve();
          }
          GMLE.storage.getLeads(id).then(function (leads) {
            var job = GMLE.jobManager.create({
              jobId: id,
              tabId: pj.tabId,
              searchQuery: pj.searchQuery,
              targetLeads: pj.targetLeads,
              fields: GMLE.FIELDS
            });
            job.status = pj.status || GMLE.States.RUNNING;
            job.startedAt = pj.startedAt || Date.now();
            job.leads = leads;
            job.savedCount = leads.length;
            job.seen = new Set(leads.map(function (l) { return l.fingerprint; }));
            currentJobId = id;
            GMLE.debug.log('info', 'sw', 'restored live job=' + id + ' leads=' + leads.length + ' (SW restart)');
            resolve();
          });
        }, 1200);
      });
    });
  }).catch(function (e) {
    GMLE.debug.log('warn', 'sw', 'job restore failed: ' + String(e));
  });
  return restorePromise;
}

// --- Debug/trace hub -------------------------------------------------------
// The SW sees all message traffic (content -> SW -> overlay), so it owns the
// trace buffers. While the overlay debug drawer is open it streams new
// entries to the overlay tab as DEBUG_EVENTS batches.
// NOTE: UI-facing pushes use tabs.sendMessage (postToTab) — runtime.sendMessage
// broadcasts do NOT reach content scripts.
var debugStream = false;
var debugStreamTabId = null;
var debugQueue = { events: [], logs: [] };
var debugFlushTimer = null;

GMLE.debug.installTap();
GMLE.debug.setListener(function (kind, entry) {
  if (!debugStream || debugStreamTabId == null) return;
  debugQueue[kind === 'log' ? 'logs' : 'events'].push(entry);
  scheduleDebugFlush();
});

function scheduleDebugFlush() {
  if (debugFlushTimer) return;
  debugFlushTimer = setTimeout(function () {
    debugFlushTimer = null;
    var evts = debugQueue.events; debugQueue.events = [];
    var lgs = debugQueue.logs; debugQueue.logs = [];
    if (!evts.length && !lgs.length) return;
    var tabId = debugStreamTabId;
    GMLE.postToTab(tabId, GMLE.MSG.DEBUG_EVENTS, { events: evts, logs: lgs })
      .catch(function () {
        // Overlay tab is gone (navigated/closed) — stop streaming to it.
        debugStream = false;
        debugStreamTabId = null;
      });
  }, 250);
}

function buildDebugSnapshot() {
  var job = currentJobId ? GMLE.jobManager.get(currentJobId) : null;
  return GMLE.storage.getCurrentJobId().then(function (storedId) {
    return {
      ts: Date.now(),
      sw: {
        currentJobId: currentJobId,
        storedCurrentJobId: storedId,
        streamActive: debugStream,
        mapsStatusByTab: mapsStatusByTab
      },
      job: job ? {
        jobId: job.jobId,
        status: job.status,
        tabId: job.tabId,
        searchQuery: job.searchQuery,
        targetLeads: job.targetLeads,
        total: job.leads.length,
        savedCount: job.savedCount,
        duplicates: job.duplicateCount,
        enrichment: job.enrichment,
        lastLeadName: job.lastLeadName,
        fields: job.fields
      } : null
    };
  });
}

// --- Job lifecycle ---------------------------------------------------------

function setState(job, to) {
  if (job.status === to) return;
  if (!GMLE.canTransition(job.status, to)) return;
  job.status = to;
  GMLE.storage.putJob(job);
  GMLE.postToTab(job.tabId, GMLE.MSG.STATE_CHANGED, { jobId: job.jobId, state: to, searchQuery: job.searchQuery });
}

function statusPayload(job) {
  return {
    jobId: job.jobId,
    state: job.status,
    total: job.leads.length,
    duplicates: job.duplicateCount,
    enrichment: job.enrichment,
    target: job.targetLeads,
    lastLeadName: job.lastLeadName
  };
}

function checkpoint(job) {
  var now = Date.now();
  if (job.leads.length - job.savedCount >= GMLE.config.checkpointLeads ||
      now - job.lastCheckpointTs >= GMLE.config.checkpointSeconds * 1000) {
    var toSave = job.leads.slice(job.savedCount);
    job.savedCount = job.leads.length;
    job.lastCheckpointTs = now;
    return GMLE.storage.putLeads(toSave).then(function () {
      return GMLE.storage.putJob(job);
    });
  }
  return Promise.resolve();
}

function handleLeads(jobId, rawLeads) {
  var job = GMLE.jobManager.get(jobId);
  if (!job) { console.warn('handleLeads: unknown job', jobId); return; }
  var added = 0, dups = 0;
  for (var i = 0; i < rawLeads.length; i++) {
    var raw = rawLeads[i];
    var fp = GMLE.fingerprint(raw);
    if (job.seen.has(fp)) { dups++; continue; }
    job.seen.add(fp);
    var lead = Object.assign({}, raw, { id: job.jobId + '::' + fp, jobId: job.jobId, fingerprint: fp });
    job.leads.push(lead);
    if (lead.name) job.lastLeadName = lead.name;
    added++;
    if (job.fields.some(function (f) { return f.key === 'email'; }) && lead.website) {
      job.enrichment.queued++;
      GMLE.Enrichment.enqueue(lead, function (l, email) {
        l.email = email;
        job.enrichment.done++;
        if (email) job.enrichment.emails++;
        GMLE.storage.putLeads([l]).catch(function () {});
      });
    }
  }
  job.duplicateCount += dups;
  job.lastLeadTs = Date.now();
  GMLE.postToTab(job.tabId, GMLE.MSG.STATUS_UPDATE, statusPayload(job));
  checkpoint(job).catch(function (e) { GMLE.debug.log('error', 'checkpoint', String(e)); });
  if (job.targetLeads && job.leads.length >= job.targetLeads && job.status === GMLE.States.RUNNING) {
    setState(job, GMLE.States.STOPPING);
    GMLE.postToTab(job.tabId, GMLE.MSG.STOP, {});
  }
}

function finalizeJob(jobId) {
  var job = GMLE.jobManager.get(jobId);
  if (!job) return;
  if (job.status !== GMLE.States.STOPPING && job.status !== GMLE.States.CAPTCHA) {
    setState(job, GMLE.States.COMPLETING);
  }
  function doComplete() {
    setState(job, GMLE.States.COMPLETED);
    GMLE.storage.setCurrentJobId(null);
    currentJobId = null;
    exportJob(jobId);
  }
  function drain() {
    if (GMLE.Enrichment.pending() > 0) { setTimeout(drain, 200); return; }
    checkpoint(job).then(doComplete).catch(function (e) {
      GMLE.debug.log('error', 'checkpoint', 'finalize: ' + String(e));
      doComplete();
    });
  }
  drain();
}

// --- Export (service worker side; content scripts have no downloads API) ---

function exportJob(jobId, uiTabId) {
  var job = GMLE.jobManager.get(jobId);
  var leads = job ? job.leads : null;
  var fields = job ? job.fields : null;
  var searchQuery = job ? job.searchQuery : '';
  var tabId = uiTabId != null ? uiTabId : (job ? job.tabId : null);

  function fail(msg) {
    GMLE.debug.log('error', 'export', msg);
    // Never fail silently: surface the error in the overlay UI.
    if (tabId != null) GMLE.postToTab(tabId, GMLE.MSG.ERROR, { message: 'Export failed: ' + msg });
  }

  function download(ls, fs, q) {
    var url, fname;
    try {
      url = GMLE.buildXlsx(ls, fs);
      fname = GMLE.filenameFor({ searchQuery: q });
    } catch (e) { fail(String(e)); return; }
    chrome.downloads.download({ url: url, filename: fname, saveAs: false }, function () {
      if (chrome.runtime.lastError) {
        fail(chrome.runtime.lastError.message);
      } else {
        GMLE.debug.log('info', 'export', 'Exported ' + ls.length + ' leads → ' + fname);
      }
    });
  }

  if (leads && leads.length) {
    download(leads, (fields && fields.length) ? fields : GMLE.FIELDS, searchQuery);
    return;
  }
  GMLE.storage.getLeads(jobId).then(function (ls) {
    download(ls, GMLE.FIELDS, searchQuery);
  }).catch(function () {
    fail('no leads found for job ' + jobId);
  });
}

function startExtraction(payload, sender) {
  if (currentJobId) {
    var old = GMLE.jobManager.get(currentJobId);
    if (old) GMLE.postToTab(old.tabId, GMLE.MSG.STOP, {});
  }
  // The overlay lives inside the Maps tab, so prefer the sender's tab id.
  var tabId = (sender && sender.tab && sender.tab.id != null)
    ? sender.tab.id
    : (payload.tabId != null ? payload.tabId : -1);
  var ms = mapsStatusByTab[tabId] || {};
  var job = GMLE.jobManager.create({
    tabId: tabId,
    searchQuery: payload.search || ms.search || '',
    targetLeads: payload.targetLeads || 0,
    fields: payload.fields || []
  });
  currentJobId = job.jobId;
  GMLE.storage.setCurrentJobId(currentJobId);
  GMLE.Enrichment.configure(GMLE.config.enrichment);
  GMLE.Enrichment.reset();
  setState(job, GMLE.States.INITIALIZING);

  if (payload.demo) {
    GMLE.debug.log('info', 'sw', 'demo run job=' + job.jobId + ' target=' + job.targetLeads);
    runDemo(job);
    return;
  }
  GMLE.postToTab(tabId, GMLE.MSG.START, { jobId: job.jobId, fields: job.fields });
  GMLE.debug.log('info', 'sw', 'start job=' + job.jobId + ' tab=' + tabId + ' target=' + job.targetLeads);
  setState(job, GMLE.States.RUNNING);
  GMLE.postToTab(tabId, GMLE.MSG.STATUS_UPDATE, statusPayload(job));
}

function runDemo(job) {
  setState(job, GMLE.States.RUNNING);
  var samples = ['Dental Clinic', 'Coffee House', 'Law Office', 'Auto Repair', 'Bakery',
    'Gym Center', 'Hotel Star', 'Book Store', 'Pet Clinic', 'Salon Bliss'];
  var n = job.targetLeads || 60;
  for (var i = 0; i < n; i++) {
    var name = samples[i % samples.length] + ' ' + (i + 1);
    var leads = [{
      name: name,
      phone: '+1' + (2000000000 + i),
      website: (i % 2 ? 'https://example.com/' + i : null),
      rating: (3 + (i % 20) / 5).toFixed(1),
      reviews: String(10 + i * 3),
      category: 'Category ' + (i % 5),
      address: (i + 10) + ' Main St, City',
      mapsUrl: 'https://www.google.com/maps/place/' + encodeURIComponent(name) + '/' + i
    }];
    handleLeads(job.jobId, leads);
  }
  setTimeout(function () { finalizeJob(job.jobId); }, 1500);
}

// --- Message router --------------------------------------------------------

GMLE.onMessage(function (msg, sender) {
  var type = msg.type, payload = msg.payload || {};
  if (type === GMLE.MSG.MAPS_STATUS) {
    if (sender.tab) mapsStatusByTab[sender.tab.id] = payload;
    // Relay back to the sending tab so its overlay UI can gate START.
    if (sender.tab) GMLE.postToTab(sender.tab.id, GMLE.MSG.MAPS_STATUS, payload);
    return;
  }
  if (type === GMLE.MSG.JOB_ACK) {
    var ackCb = liveJobAcks[payload.jobId];
    if (ackCb) ackCb();
    return;
  }
  if (type === GMLE.MSG.START_EXTRACTION) { startExtraction(payload, sender); return; }
  if (type === GMLE.MSG.STOP) {
    ensureJobRestored(sender && sender.tab ? sender.tab.id : null).then(function () { stopJob(payload.jobId); });
    return;
  }
  if (type === GMLE.MSG.LEADS_DISCOVERED) {
    ensureJobRestored().then(function () { handleLeads(payload.jobId, payload.leads); });
    return;
  }
  if (type === GMLE.MSG.LEADS_ENRICHED) {
    ensureJobRestored().then(function () { handleLeadEnriched(payload); });
    return;
  }
  if (type === GMLE.MSG.DONE) { ensureJobRestored().then(function () { finalizeJob(payload.jobId); }); return; }
  if (type === GMLE.MSG.CAPTCHA) {
    var jc = GMLE.jobManager.get(payload.jobId);
    if (jc) {
      setState(jc, GMLE.States.CAPTCHA);
      GMLE.debug.log('warn', 'sw', 'CAPTCHA detected job=' + payload.jobId);
    }
    return;
  }
  if (type === GMLE.MSG.RESUMED) {
    var jr = GMLE.jobManager.get(payload.jobId);
    if (jr) setState(jr, GMLE.States.RUNNING);
    return;
  }
  if (type === GMLE.MSG.REQUEST_EXPORT) {
    ensureJobRestored().then(function () {
      exportJob(payload.jobId, sender && sender.tab ? sender.tab.id : null);
    });
    return;
  }
  if (type === GMLE.MSG.DIAG) {
    var tag = 'diag' + (sender && sender.tab ? ':tab' + sender.tab.id : '');
    GMLE.debug.log('info', tag, 'anchors=' + payload.anchorsPlace + ' feed=' + payload.feed +
      (payload.reason ? ' reason=' + payload.reason : ''));
    return;
  }
  // The overlay asks for a status snapshot on open (state rehydration).
  if (type === GMLE.MSG.REQUEST_STATUS) {
    ensureJobRestored(sender && sender.tab ? sender.tab.id : null).then(function () {
      var tabId = (sender && sender.tab) ? sender.tab.id : null;
      if (currentJobId) {
        var jobR = GMLE.jobManager.get(currentJobId);
        if (jobR) {
          GMLE.postToTab(tabId, GMLE.MSG.STATE_CHANGED, { jobId: jobR.jobId, state: jobR.status, searchQuery: jobR.searchQuery });
          GMLE.postToTab(tabId, GMLE.MSG.STATUS_UPDATE, statusPayload(jobR));
        }
      }
      var msR = tabId != null ? mapsStatusByTab[tabId] : null;
      GMLE.postToTab(tabId, GMLE.MSG.MAPS_STATUS, msR || { ready: false, search: '', reason: 'unknown' });
    });
    return;
  }
  // Hidden-tab heartbeat: content delegates its loop timers here because
  // Chrome throttles hidden-tab timers to ~1/min, while SW->tab messages
  // are delivered instantly. Each round trip also keeps this worker alive.
  if (type === GMLE.MSG.SCHEDULE_TICK) {
    var tickDelay = Math.max(50, payload.delayMs || 50);
    var tickSenderTab = (sender && sender.tab) ? sender.tab.id : null;
    setTimeout(function () {
      if (tickSenderTab != null) GMLE.postToTab(tickSenderTab, GMLE.MSG.LOOP_TICK, { tickId: payload.tickId });
    }, tickDelay);
    return;
  }
  if (type === GMLE.MSG.DEBUG_GET_STATE) {
    debugStream = !!payload.stream;
    debugStreamTabId = payload.stream && sender && sender.tab ? sender.tab.id : null;
    if (sender && sender.tab) {
      // Backlog first (ring buffer history), then live streaming continues.
      GMLE.postToTab(sender.tab.id, GMLE.MSG.DEBUG_EVENTS, {
        events: GMLE.debug.getEvents(),
        logs: GMLE.debug.getLogs()
      });
      buildDebugSnapshot().then(function (snap) {
        GMLE.postToTab(sender.tab.id, GMLE.MSG.DEBUG_STATE, snap);
      }).catch(function (e) {
        GMLE.debug.log('error', 'debug', 'snapshot failed: ' + String(e));
      });
    }
    return;
  }
  if (type === GMLE.MSG.DEBUG_CLEAR) { GMLE.debug.clearAll(); return; }
});

// Merge detail-panel findings (phone/website/better address) into stored
// leads. Leads were already counted; only fill blanks. A newly found website
// re-queues email enrichment for that lead. Touching a lead refreshes
// lastLeadTs so the SW idle watchdog doesn't kill the job during a long
// phase-2 visit drain (visits can outlast idleTimeoutMs with no new leads).
function handleLeadEnriched(payload) {
  var job = GMLE.jobManager.get(payload.jobId);
  if (!job || !payload.updates) return;
  job.lastLeadTs = Date.now();
  var lead = job.leads.filter(function (l) { return l.fingerprint === payload.fp; })[0];
  if (!lead) return;
  var touched = false;
  if (payload.updates.phone && !lead.phone) { lead.phone = payload.updates.phone; touched = true; }
  if (payload.updates.website && !lead.website) {
    lead.website = payload.updates.website;
    touched = true;
    if (job.fields.some(function (f) { return f.key === 'email'; })) {
      job.enrichment.queued++;
      GMLE.Enrichment.enqueue(lead, function (l, email) {
        l.email = email;
        job.enrichment.done++;
        if (email) job.enrichment.emails++;
        GMLE.storage.putLeads([l]).catch(function () {});
      });
    }
  }
  // Address is an upgrade, not a fill: the panel carries the full address
  // while the card one is truncated, so overwrite it whenever we got one.
  if (payload.updates.address) { lead.address = payload.updates.address; touched = true; }
  if (touched) GMLE.storage.putLeads([lead]).catch(function () {});
}

function stopJob(jobId) {
  var job = GMLE.jobManager.get(jobId);
  if (!job) return;
  setState(job, GMLE.States.STOPPING);
  GMLE.postToTab(job.tabId, GMLE.MSG.STOP, {});
}

setInterval(function () {
  if (!currentJobId) return;
  var job = GMLE.jobManager.get(currentJobId);
  if (!job) return;
  if (job.status === GMLE.States.RUNNING &&
      Date.now() - job.lastLeadTs > GMLE.config.scroll.idleTimeoutMs) {
    setState(job, GMLE.States.STOPPING);
    GMLE.postToTab(job.tabId, GMLE.MSG.STOP, {});
  }
}, 5000);

// --- Toolbar: toggle the floating overlay in the active Maps tab -----------

function injectOverlay(tabId, thenToggle) {
  try {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      // Full manifest script list: the overlay needs content.js present too,
      // or START would reach no scraping loop.
      files: ['modules/config.js', 'modules/messaging.js', 'modules/dedupe.js',
        'modules/debug.js', 'modules/storage.js', 'modules/stateMachine.js',
        'content/selectors.js', 'content/extractors.js', 'content/content.js',
        'overlay/overlayDebug.js', 'overlay/overlay.js']
    }, function () {
      if (chrome.runtime.lastError) {
        GMLE.debug.log('warn', 'overlay', 'inject failed: ' + chrome.runtime.lastError.message);
        return;
      }
      if (thenToggle) setTimeout(function () { GMLE.postToTab(tabId, GMLE.MSG.OVERLAY_TOGGLE, {}); }, 50);
    });
  } catch (e) {
    GMLE.debug.log('error', 'overlay', String(e));
  }
}

function toggleOverlay(tabId) {
  var res = GMLE.postToTab(tabId, GMLE.MSG.OVERLAY_TOGGLE, {});
  // No listener -> content scripts not injected (tab opened before install
  // or extension reload); inject them, then toggle.
  if (res && res.catch) res.catch(function () { injectOverlay(tabId, true); });
}

chrome.action.onClicked.addListener(function (tab) {
  chrome.action.setBadgeText({ text: '' });
  if (!tab || tab.id == null) return;
  var isMaps = tab.url && /google\.[a-z.]+\/maps/.test(tab.url);
  if (!isMaps) {
    chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' });
    chrome.action.setBadgeText({ tabId: tab.id, text: 'Maps' });
    setTimeout(function () { chrome.action.setBadgeText({ tabId: tab.id, text: '' }); }, 3000);
    return;
  }
  toggleOverlay(tab.id);
});

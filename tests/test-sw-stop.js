'use strict';
// SW-side robustness tests (2026-08-30 Kansas City failure): Stop must work
// even when the SW no longer knows the job, and a DONE for an unknown job
// must flush the export from storage instead of silently doing nothing.
// Also verifies the restore cache resets after a stale abandon.

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

global.self = global;
global.GMLE = {};
global.importScripts = function () {};
global.indexedDB = {};
global.setInterval = function () { return 0; };

var tabMessages = [];   // {tabId, type, payload}
var downloads = [];
var currentJobIdSets = [];

global.chrome = {
  runtime: {
    sendMessage: function (msg) { return Promise.resolve(); },
    onMessage: { addListener: function (fn) { global.__router = fn; } },
    lastError: undefined
  },
  tabs: {
    sendMessage: function (tabId, msg) {
      tabMessages.push({ tabId: tabId, type: msg.type, payload: msg.payload });
      return Promise.resolve();
    }
  },
  storage: { local: { get: function (k, cb) { cb({}); }, set: function (o, cb) {
    if (o.currentJobId !== undefined) currentJobIdSets.push(o.currentJobId);
    if (cb) cb();
  } } },
  downloads: { download: function (opts, cb) { downloads.push(opts); if (cb) cb(); } },
  scripting: { executeScript: function () {} },
  action: { onClicked: { addListener: function () {} }, setBadgeText: function () {}, setBadgeBackgroundColor: function () {} }
};

['modules/config.js', 'modules/messaging.js', 'modules/debug.js',
  'modules/stateMachine.js', 'modules/dedupe.js', 'modules/jobManager.js'].forEach(function (rel) {
  (0, eval)(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
});

GMLE.storage = {
  getCurrentJobId: function () { return Promise.resolve(global.__storedJobId || null); },
  setCurrentJobId: function (id) { global.__storedJobId = id; return Promise.resolve(); },
  getJob: function (id) { return Promise.resolve(global.__storedJob || null); },
  getLeads: function () {
    return Promise.resolve([{ name: 'Stored Lead', phone: '+18005550000', mapsUrl: 'https://www.google.com/maps/place/Stored/1' }]);
  },
  putJob: function () { return Promise.resolve(); },
  putLeads: function () { return Promise.resolve(); }
};
GMLE.Enrichment = { configure: function () {}, reset: function () {}, pending: function () { return 0; }, enqueue: function () {} };
GMLE.buildXlsx = function () { return 'data:application/vnd.ms-excel;base64,stub'; };
GMLE.filenameFor = function (job) { return 'test-export.xlsx'; };

(0, eval)(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'));

var failed = [];
function t(name, fn) {
  try { fn(); console.log('  ok  ' + name); } catch (e) { failed.push(name); console.log('  FAIL ' + name + ' :: ' + e.message); }
}
var router = global.__router;

// --- 1. STOP for an unknown job must still reach the tab -------------------
router({ type: GMLE.MSG.STOP, payload: { jobId: 'job_gone' } }, { tab: { id: 7 } });
setTimeout(function () {
  console.log('unknown-job STOP:');
  t('STOP forwarded to the requesting tab', function () {
    var hits = tabMessages.filter(function (m) { return m.tabId === 7 && m.type === GMLE.MSG.STOP; });
    if (!hits.length) throw new Error('no STOP to tab: ' + JSON.stringify(tabMessages));
  });

  // --- 2. DONE for an unknown job must flush the storage export + release UI
  router({ type: GMLE.MSG.DONE, payload: { jobId: 'job_gone' } }, { tab: { id: 7 } });
  setTimeout(function () {
    console.log('unknown-job DONE flush:');
    t('STATE_CHANGED COMPLETED posted to the tab', function () {
      var hits = tabMessages.filter(function (m) { return m.tabId === 7 && m.type === GMLE.MSG.STATE_CHANGED &&
        m.payload && m.payload.state === GMLE.States.COMPLETED; });
      if (!hits.length) throw new Error('no COMPLETED: ' + JSON.stringify(tabMessages));
    });
    t('export ran from storage fallback', function () {
      if (!downloads.length) throw new Error('no download: ' + JSON.stringify(downloads));
      if (downloads[0].filename !== 'test-export.xlsx') throw new Error(downloads[0].filename);
    });
    t('currentJobId pointer cleared', function () {
      if (global.__storedJobId !== null) throw new Error('stored=' + global.__storedJobId);
    });

    // --- 3. Stale-abandon must reset the restore cache (retriable restore) --
    // Eval a FRESH background module: mirrors the SW waking after a
    // suspension (fresh restorePromise), which is the scenario where the
    // restore + liveness check actually runs.
    console.log('restore cache reset:');
    global.__storedJobId = 'job_stale';
    global.__storedJob = { jobId: 'job_stale', tabId: 7, status: 'RUNNING', searchQuery: 'x', targetLeads: 10, startedAt: Date.now() };
    (0, eval)(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'));
    var router2 = global.__router; // second registration replaced the handle
    var checkJobsBefore = tabMessages.filter(function (m) { return m.type === GMLE.MSG.CHECK_JOB; }).length;
    // Request 1: no live loop answers the CHECK_JOB -> abandoned, cache reset.
    router2({ type: GMLE.MSG.REQUEST_STATUS, payload: {} }, { tab: { id: 9 } });
    setTimeout(function () {
      var abandoned = global.__storedJobId === null;
      t('stale job abandoned (pointer cleared)', function () {
        if (!abandoned) throw new Error('stored pointer=' + global.__storedJobId);
      });
      // Request 2: a NEW stored job must still be restorable — the old code
      // cached the abandoned/resolved restore forever and would never even
      // attempt this restore (no second CHECK_JOB). The cache reset makes
      // the next restore attemptable.
      global.__storedJobId = 'job_live';
      global.__storedJob = { jobId: 'job_live', tabId: 7, status: 'RUNNING', searchQuery: 'x', targetLeads: 10, startedAt: Date.now() };
      router2({ type: GMLE.MSG.REQUEST_STATUS, payload: {} }, { tab: { id: 9 } });
      // Live-loop ack inside the 2.5s window; restore completes when it ends.
      setTimeout(function () {
        router2({ type: GMLE.MSG.JOB_ACK, payload: { jobId: 'job_live' } }, { tab: { id: 7 } });
      }, 500);
      setTimeout(function () {
        t('restore retried for a new job after abandon (cache reset)', function () {
          var checkJobsAfter = tabMessages.filter(function (m) { return m.type === GMLE.MSG.CHECK_JOB; }).length;
          if (checkJobsAfter < checkJobsBefore + 2) {
            throw new Error('CHECK_JOB count ' + checkJobsBefore + ' -> ' + checkJobsAfter);
          }
        });
        t('live job restored on ack (STATUS_UPDATE sent)', function () {
          var st = tabMessages.filter(function (m) { return m.type === GMLE.MSG.STATUS_UPDATE; });
          if (!st.length) throw new Error('no STATUS_UPDATE: ' + JSON.stringify(tabMessages.map(function (m) { return m.type; })));
        });
        if (failed.length) { console.log('\nFAILED: ' + failed.join(', ')); process.exit(1); }
        console.log('\nALL PASS');
        process.exit(0);
      }, 3200);
    }, 3000);
  }, 300);
}, 300);

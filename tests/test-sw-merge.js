'use strict';
// SW-side merge test: background.js handleLeadEnriched must fill blanks only,
// upgrade address, re-queue email enrichment when a website appears, and
// refresh job.lastLeadTs (keeps the SW idle watchdog fed during a long
// phase-2 visit drain).

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

global.self = global;
global.GMLE = {};
global.importScripts = function () {}; // background.js lists its modules; we load them ourselves
global.indexedDB = {};                 // real storage.js not loaded; GMLE.storage is stubbed below
global.setInterval = function () { return 0; }; // background's idle watchdog would keep the process alive

global.chrome = {
  runtime: { sendMessage: function () { return Promise.resolve(); }, onMessage: { addListener: function () {} } },
  tabs: { sendMessage: function () { return Promise.resolve(); } },
  storage: { local: { get: function (k, cb) { cb({}); }, set: function (o, cb) { if (cb) cb(); } } },
  downloads: { download: function () {} },
  scripting: { executeScript: function () {} },
  action: { onClicked: { addListener: function () {} }, setBadgeText: function () {}, setBadgeBackgroundColor: function () {} }
};

['modules/config.js', 'modules/messaging.js', 'modules/debug.js',
  'modules/stateMachine.js', 'modules/dedupe.js', 'modules/jobManager.js'].forEach(function (rel) {
  (0, eval)(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
});

// In-memory stand-ins for IndexedDB storage + enrichment before background.js runs.
var storedLeads = [];
GMLE.storage = {
  getCurrentJobId: function () { return Promise.resolve(null); },
  setCurrentJobId: function () { return Promise.resolve(); },
  getJob: function () { return Promise.resolve(null); },
  getLeads: function () { return Promise.resolve([]); },
  putJob: function () { return Promise.resolve(); },
  putLeads: function (ls) { storedLeads.push.apply(storedLeads, ls); return Promise.resolve(); }
};
var enqueued = [];
GMLE.Enrichment = {
  configure: function () {}, reset: function () {},
  pending: function () { return 0; },
  enqueue: function (lead, cb) { enqueued.push(lead); }
};

(0, eval)(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'));

var job = GMLE.jobManager.create({ jobId: 'job_merge', tabId: 1, searchQuery: 'restaurant', fields: GMLE.FIELDS });
job.status = GMLE.States.RUNNING;
var l1 = { name: 'Alpha', mapsUrl: 'https://www.google.com/maps/place/Alpha/1', fingerprint: 'U:https://www.google.com/maps/place/Alpha/1', phone: null, website: null, address: 'B231 Johar' };
var l2 = { name: 'Beta', mapsUrl: 'https://www.google.com/maps/place/Beta/2', fingerprint: 'U:https://www.google.com/maps/place/Beta/2', phone: '04235755012', website: 'https://already.example.com/', address: null };
job.leads.push(l1, l2);

var failed = [];
function t(name, fn) {
  try { fn(); console.log('  ok  ' + name); } catch (e) { failed.push(name); console.log('  FAIL ' + name + ' :: ' + e.message); }
}

// l1: phase-2 found everything
var before = job.lastLeadTs = 1;
setTimeout(function () {
  handleLeadEnriched({ jobId: 'job_merge', fp: l1.fingerprint, updates: {
    phone: '+922133220642', website: 'https://alpha.example.com/', address: 'Plot 12, Block 4, Clifton, Karachi'
  } });

  t('blanks filled (phone/website/address)', function () {
    if (l1.phone !== '+922133220642' || l1.website !== 'https://alpha.example.com/') throw new Error(JSON.stringify(l1));
    if (l1.address !== 'Plot 12, Block 4, Clifton, Karachi') throw new Error('address not upgraded: ' + l1.address);
  });
  t('new website re-queues email enrichment', function () {
    if (enqueued.length !== 1 || enqueued[0] !== l1) throw new Error('enqueued=' + enqueued.length);
  });
  t('lastLeadTs refreshed (watchdog fed)', function () {
    if (!(job.lastLeadTs > before)) throw new Error('lastLeadTs=' + job.lastLeadTs);
  });
  t('lead persisted to storage', function () {
    if (!storedLeads.some(function (l) { return l === l1; })) throw new Error('not persisted');
  });

  // l2: phone/website already set (never overwritten); its blank address gets
  // filled, and an existing address would be upgraded (panel is authoritative).
  storedLeads.length = 0;
  handleLeadEnriched({ jobId: 'job_merge', fp: l2.fingerprint, updates: {
    phone: '+921111111111', website: 'https://other.example.com/', address: 'Nowhere St 1'
  } });
  t('phone/website never overwritten; blank address filled', function () {
    if (l2.phone !== '04235755012' || l2.website !== 'https://already.example.com/') throw new Error(JSON.stringify(l2));
    if (l2.address !== 'Nowhere St 1') throw new Error('address=' + l2.address);
  });
  t('existing address upgraded by panel value', function () {
    handleLeadEnriched({ jobId: 'job_merge', fp: l2.fingerprint, updates: { address: 'Full Panel Address, Lahore' } });
    if (l2.address !== 'Full Panel Address, Lahore') throw new Error('address=' + l2.address);
  });
  t('unknown job / lead tolerated', function () {
    handleLeadEnriched({ jobId: 'nope', fp: 'x', updates: { phone: '1' } });
    handleLeadEnriched({ jobId: 'job_merge', fp: 'U:unknown', updates: { phone: '1' } });
  });

  if (failed.length) { console.log('\nFAILED: ' + failed.join(', ')); process.exit(1); }
  console.log('\nALL PASS');
  process.exit(0);
}, 10);

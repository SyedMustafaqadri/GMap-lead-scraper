self.GMLE = self.GMLE || {};

GMLE.storage = (function () {
  var DB_NAME = 'gmap-leads';
  var DB_VERSION = 1;
  var dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('jobs')) {
          db.createObjectStore('jobs', { keyPath: 'jobId' });
        }
        if (!db.objectStoreNames.contains('leads')) {
          var s = db.createObjectStore('leads', { keyPath: 'id' });
          s.createIndex('jobId', 'jobId', { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(store, mode) {
    return openDB().then(function (db) {
      return db.transaction(store, mode).objectStore(store);
    });
  }

  return {
    putJob: function (job) {
      return tx('jobs', 'readwrite').then(function (s) {
        return new Promise(function (res, rej) {
          var r = s.put({
            jobId: job.jobId,
            searchQuery: job.searchQuery,
            targetLeads: job.targetLeads,
            status: job.status,
            startedAt: job.startedAt,
            updatedAt: Date.now()
          });
          r.onsuccess = function () { res(); };
          r.onerror = function () { rej(r.error); };
        });
      });
    },
    getJob: function (jobId) {
      return tx('jobs', 'readonly').then(function (s) {
        return new Promise(function (res, rej) {
          var r = s.get(jobId);
          r.onsuccess = function () { res(r.result); };
          r.onerror = function () { rej(r.error); };
        });
      });
    },
    putLeads: function (leads) {
      if (!leads || !leads.length) return Promise.resolve();
      return openDB().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction('leads', 'readwrite');
          var s = t.objectStore('leads');
          leads.forEach(function (l) { s.put(l); });
          t.oncomplete = function () { resolve(); };
          t.onerror = function () { reject(t.error); };
        });
      });
    },
    getLeads: function (jobId) {
      return tx('leads', 'readonly').then(function (s) {
        return new Promise(function (res, rej) {
          var out = [];
          var r = s.index('jobId').openCursor(IDBKeyRange.only(jobId));
          r.onsuccess = function () {
            var cur = r.result;
            if (cur) { out.push(cur.value); cur.continue(); }
            else res(out);
          };
          r.onerror = function () { rej(r.error); };
        });
      });
    },
    deleteJob: function (jobId) {
      return openDB().then(function (db) {
        return new Promise(function (resolve) {
          var t = db.transaction(['leads', 'jobs'], 'readwrite');
          var ls = t.objectStore('leads');
          var idx = ls.index('jobId');
          var r = idx.openKeyCursor(IDBKeyRange.only(jobId));
          r.onsuccess = function () {
            var cur = r.result;
            if (cur) { ls.delete(cur.primaryKey); cur.continue(); }
          };
          t.objectStore('jobs').delete(jobId);
          t.oncomplete = function () { resolve(); };
          t.onerror = function () { resolve(); };
        });
      });
    },
    getSettings: function () {
      return new Promise(function (res) {
        chrome.storage.local.get('settings', function (o) { res(o.settings || null); });
      });
    },
    saveSettings: function (s) {
      return new Promise(function (res) {
        chrome.storage.local.set({ settings: s }, function () { res(); });
      });
    },
    setCurrentJobId: function (id) {
      return new Promise(function (res) {
        chrome.storage.local.set({ currentJobId: id }, function () { res(); });
      });
    },
    getCurrentJobId: function () {
      return new Promise(function (res) {
        chrome.storage.local.get('currentJobId', function (o) { res(o.currentJobId || null); });
      });
    }
  };
})();

self.GMLE = self.GMLE || {};

GMLE.jobManager = (function () {
  var jobs = new Map();

  function genId() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    var ts = '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    var rand = Math.random().toString(36).slice(2, 6);
    return 'job_' + ts + '_' + rand;
  }

  function create(opts) {
    var job = {
      jobId: opts.jobId || genId(),
      tabId: opts.tabId,
      searchQuery: opts.searchQuery || '',
      targetLeads: opts.targetLeads || 0,
      fields: opts.fields || [],
      status: GMLE.States.IDLE,
      startedAt: Date.now(),
      leads: [],
      seen: new Set(),
      savedCount: 0,
      lastCheckpointTs: Date.now(),
      lastLeadTs: Date.now(),
      duplicateCount: 0,
      enrichment: { queued: 0, done: 0, emails: 0 },
      lastLeadName: ''
    };
    jobs.set(job.jobId, job);
    return job;
  }

  return {
    create: create,
    get: function (id) { return jobs.get(id); },
    all: function () { return Array.from(jobs.values()); },
    remove: function (id) { jobs.delete(id); }
  };
})();

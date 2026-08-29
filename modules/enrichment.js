self.GMLE = self.GMLE || {};

GMLE.Enrichment = (function () {
  var queue = [];
  var active = 0;
  var pool = 5;
  var stopped = false;
  var EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  function fetchText(url, ms) {
    return new Promise(function (resolve) {
      var c = new AbortController();
      var t = setTimeout(function () { c.abort(); }, ms);
      fetch(url, { signal: c.signal, redirect: 'follow' })
        .then(function (r) {
          clearTimeout(t);
          if (!r.ok) return resolve(null);
          var ct = r.headers.get('content-type') || '';
          if (ct.indexOf('text/html') === -1) return resolve(null);
          return r.text().then(resolve);
        })
        .catch(function () { clearTimeout(t); resolve(null); });
    });
  }

  function extractEmails(html) {
    var m = html.match(EMAIL_RE) || [];
    return Array.from(new Set(m.map(function (e) { return e.toLowerCase(); })));
  }

  function fetchEmails(website) {
    return fetchText(website, GMLE.config.enrichment.timeoutMs).then(function (html) {
      if (!html) return [];
      var emails = extractEmails(html);
      if (emails.length) return emails;
      try {
        var u = new URL(website);
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var links = Array.from(doc.querySelectorAll('a[href]'))
          .map(function (a) { return a.href; })
          .filter(function (h) { return /contact|about|reach|email|get-in-touch|kontakt/i.test(h); });
        var pages = 0;
        var chain = Promise.resolve(emails);
        links.slice(0, GMLE.config.enrichment.maxPages - 1).forEach(function (link) {
          chain = chain.then(function (acc) {
            if (acc.length) return acc;
            return fetchText(link, GMLE.config.enrichment.timeoutMs).then(function (h) {
              return h ? acc.concat(extractEmails(h)) : acc;
            });
          });
        });
        return chain.then(function (acc) { return Array.from(new Set(acc)); });
      } catch (e) {
        return emails;
      }
    });
  }

  function worker() {
    if (stopped || active >= pool) return;
    var item = queue.shift();
    if (!item) return;
    active++;
    var lead = item.lead;
    var onResult = item.onResult;
    fetchEmails(lead.website).then(function (emails) {
      onResult(lead, emails.length ? emails[0] : null);
      active--;
      if (!stopped && queue.length) worker();
    }).catch(function () {
      onResult(lead, null);
      active--;
      if (!stopped && queue.length) worker();
    });
  }

  return {
    configure: function (p) { if (p && p.concurrency) pool = p.concurrency; },
    enqueue: function (lead, onResult) {
      queue.push({ lead: lead, onResult: onResult });
      worker();
    },
    pending: function () { return queue.length + active; },
    stop: function () { stopped = true; },
    reset: function () { queue = []; active = 0; stopped = false; }
  };
})();

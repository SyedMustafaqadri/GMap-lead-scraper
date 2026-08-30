'use strict';
// (b) Detail-panel scrape from a small DOM mock: phone via
// button[data-item-id^="phone"] (innerText and aria-label forms), website via
// a[data-item-id^="authority"], address upgrade via button[data-item-id="address"].
// Drives the real content-script phase-2 visit end-to-end and inspects the
// exact LEADS_ENRICHED payloads.

var harness = require('./harness.js');
var assert = harness.assert;
var mockdom = require('./mockdom.js');

var env = harness.load();
harness.shrinkTimers(env.GMLE);
harness.setSearchRoute(env);
env.document.body.innerText = "You've reached the end of the list.";
env.closeButtons = [];

env.places = {
  'https://www.google.com/maps/place/Alpha+Dentistry/1': {
    phoneText: '+92 21 33220642',
    website: 'https://alpha-dentistry.example.com/',
    address: 'Plot 12, Block 4, Clifton, Karachi, Pakistan'
  },
  'https://www.google.com/maps/place/Beta+Dental/2': {
    phoneAria: 'Phone: 0331 2048149',
    addressNoAria: true,
    address: 'B231 Johar Hill Rd, Lahore'
  }
};

harness.buildFeed(env, [
  { name: 'Alpha Dentistry', href: 'https://www.google.com/maps/place/Alpha+Dentistry/1',
    lines: ['Alpha Dentistry', 'Dentist · Block 4'] },
  { name: 'Beta Dental', href: 'https://www.google.com/maps/place/Beta+Dental/2',
    lines: ['Beta Dental', 'Dentist · Johar Hill'] }
]);
// Wire the panel opener onto both anchors.
env.feed.children.forEach(function (card) {
  card.children.forEach(function (ch) {
    if (ch.tagName === 'A') ch.onclick = harness.panelOpener(env, env.closeButtons);
  });
});

harness.start(env);

harness.waitFor(function () {
  var done = harness.msgOf(env, 'DONE');
  return done.length && done[done.length - 1];
}, 10000, 'phase-2 DONE').then(function (done) {
  var enriched = harness.msgOf(env, 'LEADS_ENRICHED');
  assert(done.payload.reason === 'end', 'DONE reason=' + done.payload.reason);
  assert(enriched.length === 2, 'expected 2 LEADS_ENRICHED, got ' + enriched.length);

  var u1 = enriched[0].payload.updates;
  assert(enriched[0].payload.jobId === 'job_test', 'jobId');
  assert(u1.phone === '+922133220642', 'phone normalized from innerText: ' + u1.phone);
  assert(u1.website === 'https://alpha-dentistry.example.com/', 'website from authority link: ' + u1.website);
  assert(u1.address === 'Plot 12, Block 4, Clifton, Karachi, Pakistan', 'address upgraded from aria-label: ' + u1.address);

  var u2 = enriched[1].payload.updates;
  assert(u2.phone === '03312048149', 'phone from aria-label (no innerText): ' + u2.phone);
  assert(u2.address === 'B231 Johar Hill Rd, Lahore', 'address falls back to innerText: ' + u2.address);
  assert(!u2.website, 'no website -> no website update');

  // No close between visits: panels swap in place. After DONE, one courtesy
  // Escape dismisses the final panel (mock honors it) — and the native Close
  // button was never clicked, so the SPA reset trigger was never touched.
  assert(!env.document.body.querySelector('div[role="main"]'), 'panel removed after run (courtesy Escape)');
  assert(!env.document.body.querySelector('button[aria-label="Close"]'), 'close button removed');
  assert(/\/maps\/search\//.test(global.location.href), 'search route preserved');
  env.closeButtons.forEach(function (b, i) {
    assert(!b.__clicked, 'close button #' + i + ' was clicked (must be bypassed)');
  });
  var visitDiags = harness.msgOf(env, 'DIAG').filter(function (m) { return m.payload.reason === 'phase2-visit'; });
  assert(visitDiags.length === 2, 'visit diags=' + visitDiags.length);

  console.log('ALL PASS');
  process.exit(0);
}).catch(function (e) {
  console.error('FAIL:', e.message);
  console.error('messages:', JSON.stringify(env.messages.map(function (m) {
    return { t: m.type, p: m.payload && (m.payload.reason || m.payload.name || m.payload.leads && m.payload.leads.length || '') };
  })));
  process.exit(1);
});

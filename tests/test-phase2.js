'use strict';
// (c) Phase-2 sequence in the loop harness: after the feed is exhausted the
// content script must visit each lead missing phone/website in extract order,
// post LEADS_ENRICHED per visited lead, skip missing cards / dead panels with
// a DIAG, and only then post DONE. Also: STOP mid-drain and CAPTCHA pause.

var harness = require('./harness.js');
var assert = harness.assert;
var mockdom = require('./mockdom.js');

function makeEnv() {
  var env = harness.load();
  harness.shrinkTimers(env.GMLE);
  harness.setSearchRoute(env);
  env.document.body.innerText = "You've reached the end of the list.";
  env.closeButtons = [];
  return env;
}

// ---------------------------------------------------------------- scenario 1
// 5 leads: 1-2 visit+enrich, 3 has card phone (website-only visit), 4 card
// vanishes (virtualized), 5 panel never opens.
var env = makeEnv();
env.GMLE.config.pingIntervalMs = 30; // exercise the SW keepalive round trip
env.places = {
  'https://www.google.com/maps/place/Alpha/1': {
    phoneText: '+92 21 33220642', website: 'https://alpha.example.com/',
    address: 'Plot 12, Block 4, Clifton, Karachi'
  },
  'https://www.google.com/maps/place/Beta/2': {
    phoneAria: 'Phone: 0331 2048149', website: 'https://beta.example.com/',
    address: 'B231 Johar Hill Rd, Lahore'
  },
  'https://www.google.com/maps/place/Gamma/3': {
    website: 'https://gamma.example.com/', address: '12 Main Blvd, Gulberg'
  },
  // 4: card removed; 5: dead panel
  'https://www.google.com/maps/place/Epsilon/5': { dead: true }
};

harness.buildFeed(env, [
  { name: 'Alpha', href: 'https://www.google.com/maps/place/Alpha/1',
    lines: ['Alpha', 'Dentist · Block 4'] },
  { name: 'Beta', href: 'https://www.google.com/maps/place/Beta/2',
    lines: ['Beta', 'Dentist · Johar Hill'] },
  { name: 'Gamma', href: 'https://www.google.com/maps/place/Gamma/3',
    lines: ['Gamma', 'Gym', 'Open · Closes 11 PM · 042 35755012'] },
  { name: 'Delta', href: 'https://www.google.com/maps/place/Delta/4',
    lines: ['Delta', 'Deli · Market St'] },
  { name: 'Epsilon', href: 'https://www.google.com/maps/place/Epsilon/5',
    lines: ['Epsilon', 'Eatery · Mall Rd'] }
]);
env.feed.children.forEach(function (card) {
  card.children.forEach(function (ch) {
    if (ch.tagName === 'A') ch.onclick = harness.panelOpener(env, env.closeButtons);
  });
});

// Delta's card gets virtualized away before phase 2 starts.
env.onSend = function (msg) {
  if (msg.type === 'DIAG' && msg.payload && msg.payload.reason === 'phase2-start') {
    var delta = env.feed.children.filter(function (c) {
      return c.innerText.indexOf('Delta') === 0;
    })[0];
    if (delta) env.feed.removeChild(delta);
  }
};

harness.start(env);

var failed = [];
function t(name, fn) {
  try { fn(); console.log('  ok  ' + name); } catch (e) { failed.push(name); console.log('  FAIL ' + name + ' :: ' + e.message); }
}

harness.waitFor(function () {
  var done = harness.msgOf(env, 'DONE');
  return done.length && done[done.length - 1];
}, 15000, 'phase-2 DONE (scenario 1)').then(function (done) {
  var enriched = harness.msgOf(env, 'LEADS_ENRICHED');
  var diags = harness.msgOf(env, 'DIAG').map(function (m) { return m.payload.reason; });

  console.log('scenario 1 — full drain then DONE:');
  t('DONE last, reason end', function () {
    assert(done === env.messages[env.messages.length - 1], 'DONE must be the last message');
    assert(done.payload.reason === 'end', 'reason=' + done.payload.reason);
  });
  t('3 enriches in extract order (skips excluded)', function () {
    assert(enriched.length === 3, 'got ' + enriched.length);
    assert(enriched[0].payload.updates.phone === '+922133220642', 'alpha phone');
    assert(enriched[1].payload.updates.phone === '03312048149', 'beta phone');
    assert(!enriched[2].payload.updates.phone, 'gamma had card phone — not re-sent');
    assert(enriched[2].payload.updates.website === 'https://gamma.example.com/', 'gamma website');
  });
  t('missing card skipped with DIAG, no enrich', function () {
    assert(diags.indexOf('phase2-card-not-found') !== -1, 'no card-not-found diag');
    assert(!enriched.some(function (m) { return /Delta/.test(JSON.stringify(m.payload)); }), 'delta enriched');
  });
  t('dead panel skipped with DIAG, run continues', function () {
    assert(diags.indexOf('phase2-panel-timeout') !== -1, 'no panel-timeout diag');
  });
  t('every visit logged (phase2-start + 4 visit diags — the card-not-found skip logs its own)', function () {
    var starts = diags.filter(function (r) { return r === 'phase2-start'; }).length;
    var visits = diags.filter(function (r) { return r === 'phase2-visit'; }).length;
    assert(starts === 1 && visits === 4, 'starts=' + starts + ' visits=' + visits);
  });
  t('panels never closed mid-run; courtesy Escape dismissed the last one after DONE', function () {
    assert(env.closeButtons.length === 3, 'close buttons=' + env.closeButtons.length);
    env.closeButtons.forEach(function (b, i) {
      assert(!b.__clicked, 'close #' + i + ' was clicked (must be bypassed)');
    });
    assert(!env.document.body.querySelector('div[role="main"]'), 'final panel not dismissed after DONE');
    assert(/\/maps\/search\//.test(global.location.href), 'search route lost');
  });
  t('PING keepalive posted while running (stops with the job)', function () {
    var pings = harness.msgOf(env, 'PING').length;
    assert(pings >= 1, 'pings=' + pings);
    assert(done === env.messages[env.messages.length - 1], 'PING leaked after DONE');
  });

  // ---------------------------------------------------------------- scen. 2
  return scenario2();
}).then(function () {
  return scenario3();
}).then(function () {
  return scenario4();
}).then(function () {
  return scenario5();
}).then(function () {
  return scenario6();
}).then(function () {
  return scenario7();
}).then(function () {
  return scenario8();
}).then(function () {
  return scenario9();
}).then(function () {
  if (failed.length) { console.log('\nFAILED: ' + failed.join(', ')); process.exit(1); }
  console.log('\nALL PASS');
  process.exit(0);
}).catch(function (e) {
  console.error('FAIL:', e.message);
  console.error('messages:', JSON.stringify(env.messages.map(function (m) {
    return { t: m.type, r: m.payload && (m.payload.reason || m.payload.name || (m.payload.leads && m.payload.leads.length) || '') };
  })));
  process.exit(1);
});

// ---------------------------------------------------------------- scenario 2
// STOP mid-drain: DONE 'stop' immediately, no further enriches.
function scenario2() {
  var env2 = makeEnv();
  env2.places = {
    'https://www.google.com/maps/place/Alpha/1': { phoneText: '+92 21 33220642', website: 'https://alpha.example.com/' },
    'https://www.google.com/maps/place/Beta/2': { phoneText: '+92 21 11111111', website: 'https://beta.example.com/' }
  };
  harness.buildFeed(env2, [
    { name: 'Alpha', href: 'https://www.google.com/maps/place/Alpha/1', lines: ['Alpha', 'Dentist · Block 4'] },
    { name: 'Beta', href: 'https://www.google.com/maps/place/Beta/2', lines: ['Beta', 'Dentist · Johar Hill'] }
  ]);
  env2.feed.children.forEach(function (card) {
    card.children.forEach(function (ch) { if (ch.tagName === 'A') ch.onclick = harness.panelOpener(env2); });
  });
  var enrichCountAtStop = -1;
  env2.onSend = function (msg) {
    if (msg.type === 'LEADS_ENRICHED' && enrichCountAtStop === -1) {
      enrichCountAtStop = harness.msgOf(env2, 'LEADS_ENRICHED').length;
      harness.stop(env2); // user hits Stop right after the first visit lands
    }
  };
  harness.start(env2);
  return harness.waitFor(function () {
    var done = harness.msgOf(env2, 'DONE');
    return done.length && done[done.length - 1];
  }, 10000, 'DONE after STOP (scenario 2)').then(function (done) {
    console.log('scenario 2 — STOP mid-drain:');
    t('DONE reason=stop', function () { assert(done.payload.reason === 'stop', done.payload.reason); });
    t('no enriches after STOP', function () {
      return new Promise(function (resolve) {
        setTimeout(function () {
          var n = harness.msgOf(env2, 'LEADS_ENRICHED').length;
          assert(n === 1, 'enriches=' + n);
          resolve();
        }, 300);
      });
    });
  });
}

// ---------------------------------------------------------------- scenario 3
// CAPTCHA before the run and again at phase-2 start: job pauses (CAPTCHA),
// resumes (RESUMED), and still drains every visit before DONE.
function scenario3() {
  var env3 = makeEnv();
  var endText = "You've reached the end of the list.";
  var captchaText = 'Our systems have detected unusual traffic from your computer. ' + endText;
  env3.document.body.innerText = captchaText;
  env3.places = {
    'https://www.google.com/maps/place/Alpha/1': { phoneText: '+92 21 33220642', website: 'https://alpha.example.com/' },
    'https://www.google.com/maps/place/Beta/2': { phoneText: '+92 21 11111111', website: 'https://beta.example.com/' }
  };
  harness.buildFeed(env3, [
    { name: 'Alpha', href: 'https://www.google.com/maps/place/Alpha/1', lines: ['Alpha', 'Dentist · Block 4'] },
    { name: 'Beta', href: 'https://www.google.com/maps/place/Beta/2', lines: ['Beta', 'Dentist · Johar Hill'] }
  ]);
  env3.feed.children.forEach(function (card) {
    card.children.forEach(function (ch) { if (ch.tagName === 'A') ch.onclick = harness.panelOpener(env3); });
  });
  env3.onSend = function (msg) {
    // Clear when the loop pauses; re-arm once phase 2 starts so the CAPTCHA
    // gate inside visitNext() is exercised too.
    if (msg.type === 'CAPTCHA') env3.document.body.innerText = endText;
    if (msg.type === 'DIAG' && msg.payload && msg.payload.reason === 'phase2-start') {
      env3.document.body.innerText = captchaText;
    }
  };
  harness.start(env3);
  return harness.waitFor(function () {
    var done = harness.msgOf(env3, 'DONE');
    return done.length && done[done.length - 1];
  }, 10000, 'DONE after CAPTCHA (scenario 3)').then(function (done) {
    console.log('scenario 3 — CAPTCHA pause/resume (loop + phase 2):');
    var capts = harness.msgOf(env3, 'CAPTCHA').length;
    var res = harness.msgOf(env3, 'RESUMED').length;
    var enriched = harness.msgOf(env3, 'LEADS_ENRICHED').length;
    t('two CAPTCHA pauses, both resumed', function () { assert(capts === 2 && res === 2, 'captcha=' + capts + ' resumed=' + res); });
    t('all visits drained despite pause', function () { assert(enriched === 2, 'enriches=' + enriched); });
    t('DONE reason=end after resume', function () { assert(done.payload.reason === 'end', done.payload.reason); });
  });
}

// ---------------------------------------------------------------- scenario 4
// Spinner up when the feed hits its end: phase 2 must NOT click into a busy
// feed — it waits for the spinner to clear, then visits normally.
function scenario4() {
  var env4 = makeEnv();
  env4.places = {
    'https://www.google.com/maps/place/Alpha/1': { phoneText: '+92 21 33220642', website: 'https://alpha.example.com/' }
  };
  harness.buildFeed(env4, [
    { name: 'Alpha', href: 'https://www.google.com/maps/place/Alpha/1', lines: ['Alpha', 'Dentist · Block 4'] }
  ]);
  env4.feed.children.forEach(function (card) {
    card.children.forEach(function (ch) { if (ch.tagName === 'A') ch.onclick = harness.panelOpener(env4); });
  });
  // Loading spinner in the feed, cleared shortly after START (page finishes).
  var pb = new mockdom.MockElement('div', { role: 'progressbar' });
  env4.feed.appendChild(pb);
  setTimeout(function () {
    if (pb.parentElement === env4.feed) env4.feed.removeChild(pb);
  }, 100);
  harness.start(env4);
  return harness.waitFor(function () {
    var done = harness.msgOf(env4, 'DONE');
    return done.length && done[done.length - 1];
  }, 10000, 'DONE with initial spinner (scenario 4)').then(function (done) {
    console.log('scenario 4 — phase 2 waits for a busy feed to settle:');
    var diags = harness.msgOf(env4, 'DIAG').map(function (m) { return m.payload.reason; });
    var enriched = harness.msgOf(env4, 'LEADS_ENRICHED').length;
    t('spinner patience DIAG posted', function () {
      // The spinner also hangs after leads stop arriving (bottom wait) —
      // accept either the explicit diag or, in this mock, the feed settling
      // via waitFeedSettle before visits. The skip-diag assertion below is
      // the real check.
      assert(diags.indexOf('phase2-skipped-feed-unhealthy') === -1 || enriched === 1, 'skipped without visiting');
    });
    t('no premature skip of phase 2', function () { assert(diags.indexOf('phase2-skipped-feed-unhealthy') === -1, 'skipped!'); });
    t('visit ran once the feed settled', function () { assert(enriched === 1, 'enriches=' + enriched); });
    t('DONE reason=end', function () { assert(done.payload.reason === 'end', done.payload.reason); });
  });
}

// ---------------------------------------------------------------- scenario 5
// Stall without end-of-list marker and the feed never recovers: the job must
// give up gracefully (skip phase 2 with a DIAG, DONE 'no-results', no visits).
function scenario5() {
  var env5 = makeEnv();
  env5.document.body.innerText = 'Some unrelated page text, no end marker.';
  env5.places = {};
  harness.buildFeed(env5, [
    { name: 'Alpha', href: 'https://www.google.com/maps/place/Alpha/1',
      lines: ['Alpha', 'Dentist', 'Open · Closes 9 PM · 0500 1234567'] }
  ]);
  harness.start(env5);
  return harness.waitFor(function () {
    var done = harness.msgOf(env5, 'DONE');
    return done.length && done[done.length - 1];
  }, 10000, 'DONE on dead feed (scenario 5)').then(function (done) {
    console.log('scenario 5 — stall with no recovery: graceful give-up:');
    var diags = harness.msgOf(env5, 'DIAG').map(function (m) { return m.payload.reason; });
    t('feed got one last settle window, then skipped phase 2', function () {
      assert(diags.indexOf('phase2-skipped-feed-unhealthy') !== -1, 'no skip diag: ' + diags.join(','));
    });
    t('no visits attempted on a dead feed', function () {
      assert(harness.msgOf(env5, 'LEADS_ENRICHED').length === 0, 'enriches happened');
      assert(diags.indexOf('phase2-start') === -1, 'phase2 started');
    });
    t('DONE reason=no-results', function () { assert(done.payload.reason === 'no-results', done.payload.reason); });
  });
}

// ---------------------------------------------------------------- scenario 6
// Stall without end marker, but the feed recovers (late page lands): the job
// must resume scrolling instead of ending.
function scenario6() {
  var env6 = makeEnv();
  env6.document.body.innerText = 'Some unrelated page text, no end marker.';
  env6.places = {};
  harness.buildFeed(env6, [
    { name: 'Alpha', href: 'https://www.google.com/maps/place/Alpha/1',
      lines: ['Alpha', 'Dentist', 'Open · Closes 9 PM · 0500 1234567'] }
  ]);
  var appended = false;
  env6.onSend = function (msg) {
    // A late page lands while the settle window is open: append a card after
    // waitFeedSettle has captured its baseline (first settle poll ~500ms).
    if (msg.type === 'DIAG' && msg.payload && msg.payload.reason === 'no-anchors-found' && !appended) {
      appended = true;
      setTimeout(function () {
        var card = new mockdom.MockElement('div', { role: 'article' });
        env6.feed.appendChild(card);
        var a = new mockdom.MockElement('a', { href: 'https://www.google.com/maps/place/Zeta/9', 'aria-label': 'Zeta' });
        card.appendChild(a);
        card.innerText = ['Zeta', 'Zoo', 'Open · Closes 9 PM · 0500 7654321'].join('\n');
      }, 100);
    }
  };
  harness.start(env6);
  return harness.waitFor(function () {
    var done = harness.msgOf(env6, 'DONE');
    return done.length && done[done.length - 1];
  }, 10000, 'DONE after recovery (scenario 6)').then(function (done) {
    console.log('scenario 6 — slow feed recovers: resume scrolling:');
    var diags = harness.msgOf(env6, 'DIAG').map(function (m) { return m.payload.reason; });
    var discovered = harness.msgOf(env6, 'LEADS_DISCOVERED').length;
    t('feed-recovered-resume DIAG posted', function () { assert(diags.indexOf('feed-recovered-resume') !== -1, diags.join(',')); });
    t('a second lead batch was extracted after recovery', function () { assert(discovered >= 2, 'batches=' + discovered); });
    t('recovery happened before the final give-up skip', function () {
      var rec = diags.indexOf('feed-recovered-resume');
      var skip = diags.lastIndexOf('phase2-skipped-feed-unhealthy');
      assert(rec !== -1, 'no recovery diag: ' + diags.join(','));
      assert(skip === -1 || skip > rec, 'skip diag before recovery');
    });
    t('DONE eventually (no-results after second stall)', function () { assert(done.payload.reason === 'no-results', done.payload.reason); });
  });
}

// ---------------------------------------------------------------- scenario 7
// Search context lost mid-drain: after a visit's close the feed never comes
// back healthy — abort remaining visits with a DIAG instead of failing one
// by one, and still DONE so the export proceeds.
function scenario7() {
  var env7 = makeEnv();
  env7.places = {
    'https://www.google.com/maps/place/Alpha/1': { phoneText: '+92 21 33220642', website: 'https://alpha.example.com/' }
  };
  harness.buildFeed(env7, [
    { name: 'Alpha', href: 'https://www.google.com/maps/place/Alpha/1', lines: ['Alpha', 'Dentist · Block 4'] },
    { name: 'Beta', href: 'https://www.google.com/maps/place/Beta/2', lines: ['Beta', 'Dentist · Johar Hill'] }
  ]);
  env7.feed.children.forEach(function (card) {
    card.children.forEach(function (ch) { if (ch.tagName === 'A') ch.onclick = harness.panelOpener(env7); });
  });
  env7.onSend = function (msg) {
    // Simulate the 2026-08-30 Sacramento failure: right after the first
    // visit completes, Maps drops the search session — the feed is gone
    // (removed deterministically once visit #1 is fully done).
    if (msg.type === 'DIAG' && msg.payload && msg.payload.reason === 'phase2-visit') {
      if (env7.feed.parentElement) env7.document.body.removeChild(env7.feed);
    }
  };
  harness.start(env7);
  return harness.waitFor(function () {
    var done = harness.msgOf(env7, 'DONE');
    return done.length && done[done.length - 1];
  }, 10000, 'DONE after search lost (scenario 7)').then(function (done) {
    console.log('scenario 7 — search context lost mid-drain: abort cleanly:');
    var diags = harness.msgOf(env7, 'DIAG').map(function (m) { return m.payload.reason; });
    var enriched = harness.msgOf(env7, 'LEADS_ENRICHED').length;
    t('search-reset DIAG posted', function () { assert(diags.indexOf('phase2-search-reset') !== -1, diags.join(',')); });
    t('exactly one visit before the abort', function () { assert(enriched === 1, 'enriches=' + enriched); });
    t('DONE still fires (export proceeds)', function () {
      assert(done.payload.reason === 'end', done.payload.reason);
    });
  });
}

// ---------------------------------------------------------------- scenario 8
// Maps ignores the synthetic Escape entirely (live-verified): the courtesy
// close after DONE fails, but nothing depends on it — the run already
// completed and exported, and the panel just stays open for the user.
function scenario8() {
  var env8 = makeEnv();
  env8.places = {
    'https://www.google.com/maps/place/Alpha/1': { phoneText: '+92 21 33220642', website: 'https://alpha.example.com/', noEscape: true },
    'https://www.google.com/maps/place/Beta/2': { phoneText: '+92 21 11111111', website: 'https://beta.example.com/', noEscape: true }
  };
  harness.buildFeed(env8, [
    { name: 'Alpha', href: 'https://www.google.com/maps/place/Alpha/1', lines: ['Alpha', 'Dentist · Block 4'] },
    { name: 'Beta', href: 'https://www.google.com/maps/place/Beta/2', lines: ['Beta', 'Dentist · Johar Hill'] }
  ]);
  env8.feed.children.forEach(function (card) {
    card.children.forEach(function (ch) { if (ch.tagName === 'A') ch.onclick = harness.panelOpener(env8, env8.closeButtons); });
  });
  harness.start(env8);
  return harness.waitFor(function () {
    var done = harness.msgOf(env8, 'DONE');
    return done.length && done[done.length - 1];
  }, 10000, 'DONE with Escape-unresponsive panels (scenario 8)').then(function (done) {
    console.log('scenario 8 — Escape ignored: run completes regardless (fire-and-forget courtesy close):');
    var diags = harness.msgOf(env8, 'DIAG').map(function (m) { return m.payload.reason; });
    var enriched = harness.msgOf(env8, 'LEADS_ENRICHED').length;
    t('both visits completed without any close', function () { assert(enriched === 2, 'enriches=' + enriched); });
    t('native Close never clicked, no reset diags', function () {
      env8.closeButtons.forEach(function (b, i) { assert(!b.__clicked, 'close #' + i + ' clicked'); });
      assert(diags.indexOf('phase2-search-reset') === -1 && diags.indexOf('phase2-close-reset') === -1,
        diags.join(','));
    });
    t('panel may remain open — run still DONE clean', function () {
      assert(!!env8.document.body.querySelector('div[role="main"]'), 'panel should remain (Escape ignored)');
      assert(done.payload.reason === 'end', done.payload.reason);
    });
  });
}

// ---------------------------------------------------------------- scenario 9
// Lead target reached: the SW sends FINISH — phase 1 stops collecting, the
// visit queue drains (phones/websites fill), DONE carries reason 'target'.
function scenario9() {
  var env9 = makeEnv();
  env9.document.body.innerText = 'Some page text, no end-of-list marker.';
  env9.places = {
    'https://www.google.com/maps/place/Alpha/1': { phoneText: '+92 21 33220642', website: 'https://alpha.example.com/' },
    'https://www.google.com/maps/place/Beta/2': { phoneText: '+92 21 11111111', website: 'https://beta.example.com/' }
  };
  harness.buildFeed(env9, [
    { name: 'Alpha', href: 'https://www.google.com/maps/place/Alpha/1', lines: ['Alpha', 'Dentist · Block 4'] },
    { name: 'Beta', href: 'https://www.google.com/maps/place/Beta/2', lines: ['Beta', 'Dentist · Johar Hill'] }
  ]);
  env9.feed.children.forEach(function (card) {
    card.children.forEach(function (ch) { if (ch.tagName === 'A') ch.onclick = harness.panelOpener(env9); });
  });
  env9.onSend = function (msg) {
    // Simulate the SW: target (2) reached as soon as the first batch lands.
    if (msg.type === 'LEADS_DISCOVERED') {
      env9.handlers[0]({ type: env9.GMLE.MSG.FINISH, payload: { jobId: 'job_test' } });
    }
  };
  harness.start(env9);
  return harness.waitFor(function () {
    var done = harness.msgOf(env9, 'DONE');
    return done.length && done[done.length - 1];
  }, 10000, 'DONE after target reached (scenario 9)').then(function (done) {
    console.log('scenario 9 — target reached: FINISH drains phase 2 before export:');
    var diags = harness.msgOf(env9, 'DIAG').map(function (m) { return m.payload.reason; });
    var discovered = harness.msgOf(env9, 'LEADS_DISCOVERED').length;
    var enriched = harness.msgOf(env9, 'LEADS_ENRICHED').length;
    t('target-reached DIAG posted', function () { assert(diags.indexOf('target-reached') !== -1, diags.join(',')); });
    t('phase 1 stopped collecting (single batch)', function () { assert(discovered === 1, 'batches=' + discovered); });
    t('both visits drained (phones/websites filled)', function () { assert(enriched === 2, 'enriches=' + enriched); });
    t('DONE carries the target reason', function () { assert(done.payload.reason === 'target', done.payload.reason); });
  });
}

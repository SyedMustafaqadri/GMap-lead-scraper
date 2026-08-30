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
  env.document.body.innerText = "You've reached the end of the list.";
  env.closeButtons = [];
  return env;
}

// ---------------------------------------------------------------- scenario 1
// 5 leads: 1-2 visit+enrich, 3 has card phone (website-only visit), 4 card
// vanishes (virtualized), 5 panel never opens.
var env = makeEnv();
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
  t('close clicked after each real panel (3 panels opened)', function () {
    assert(env.closeButtons.length === 3, 'close buttons=' + env.closeButtons.length);
    env.closeButtons.forEach(function (b, i) { assert(b.__clicked, 'close #' + i + ' not clicked'); });
  });

  // ---------------------------------------------------------------- scen. 2
  return scenario2();
}).then(function () {
  return scenario3();
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

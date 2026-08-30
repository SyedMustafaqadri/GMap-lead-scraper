'use strict';
// Shared harness for GMLE Node tests: loads extension scripts into a fresh
// global scope with a mock DOM + chrome stub, captures every GMLE.post.

var fs = require('fs');
var path = require('path');
var mockdom = require('./mockdom.js');
var ROOT = path.join(__dirname, '..');

var CONTENT_FILES = ['modules/config.js', 'modules/messaging.js', 'modules/dedupe.js',
  'content/selectors.js', 'content/extractors.js', 'content/content.js'];

function load(files) {
  files = files || CONTENT_FILES;
  var env = {
    document: new mockdom.MockDocument(),
    messages: [],
    handlers: [],
    onSend: null
  };
  var doc = env.document;
  global.self = global;
  global.GMLE = {};
  global.document = doc;
  global.window = { scrollBy: function () {} };
  // Non-Maps URL on purpose: content.js only arms its idle MAPS_STATUS
  // interval on Maps, and an open interval would keep this process alive.
  global.location = { href: 'https://example.com/not-maps' };
  global.chrome = {
    runtime: {
      sendMessage: function (msg) {
        env.messages.push(msg);
        if (env.onSend) { env.onSend(msg); }
        return Promise.resolve();
      },
      onMessage: { addListener: function (fn) { env.handlers.push(fn); } }
    },
    tabs: { sendMessage: function () { return Promise.resolve(); } }
  };
  files.forEach(function (rel) {
    var code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    (0, eval)(code); // indirect eval -> runs in global scope, like a script tag
  });
  env.GMLE = global.GMLE;
  return env;
}

function shrinkTimers(GMLE, panelTimeoutMs) {
  var s = GMLE.config.scroll;
  s.changeWaitPollMs = 5;
  s.changeWaitMinMs = 10;
  s.changeWaitMaxMs = 10;
  s.bottomWaitMinMs = 10;
  s.bottomWaitMaxMs = 10;
  s.loadingGiveUpMs = 30;
  s.endConfirmTimeoutMs = 100;
  s.minDelayMs = 5;
  s.maxDelayMs = 5;
  s.readPauseMinMs = 5;
  s.readPauseMaxMs = 5;
  s.stallCooldownMs = 10;
  var v = GMLE.config.visit;
  v.panelTimeoutMs = panelTimeoutMs || 300;
  v.feedReturnTimeoutMs = 50;
  v.feedReadyTimeoutMs = 50;
  v.delayMinMs = 5;
  v.delayMaxMs = 10;
  GMLE.config.captchaPollMs = 5;
  GMLE.config.pingIntervalMs = 60000; // keepalive off in content tests (no SW to answer)
}

function start(env, fields) {
  env.GMLE.config; // loaded
  env.handlers[0]({ type: env.GMLE.MSG.START, payload: { jobId: 'job_test', fields: fields || env.GMLE.FIELDS } });
}

function stop(env) {
  env.handlers[0]({ type: env.GMLE.MSG.STOP, payload: {} });
}

function waitFor(fn, timeoutMs, label) {
  var startTs = Date.now();
  return new Promise(function (resolve, reject) {
    function poll() {
      var v;
      try { v = fn(); } catch (e) { reject(e); return; }
      if (v) { resolve(v); return; }
      if (Date.now() - startTs > (timeoutMs || 10000)) {
        reject(new Error('timeout waiting for: ' + (label || 'condition')));
        return;
      }
      setTimeout(poll, 10);
    }
    poll();
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
}

function msgOf(env, type) {
  return env.messages.filter(function (m) { return m.type === type; });
}

// Build a [role="feed"] with cards. Card shape:
// { name, href, lines: [...], telHref, websiteHref, sponsored, starsAria, onClick }
function buildFeed(env, cards) {
  var mockdom = require('./mockdom.js');
  var feed = new mockdom.MockElement('div', { role: 'feed' });
  env.document.body.appendChild(feed);
  env.feed = feed;
  cards.forEach(function (c) {
    var card = new mockdom.MockElement('div', { role: 'article' });
    feed.appendChild(card);
    if (c.sponsored) card.appendChild(new mockdom.MockElement('h1', { 'aria-label': 'Sponsored' }));
    if (c.starsAria) card.appendChild(new mockdom.MockElement('span', { role: 'img', 'aria-label': c.starsAria }));
    var a = new mockdom.MockElement('a', { href: c.href, 'aria-label': c.name });
    card.appendChild(a);
    if (c.telHref) card.appendChild(new mockdom.MockElement('a', { href: c.telHref }));
    if (c.websiteHref) card.appendChild(new mockdom.MockElement('a', { 'data-value': 'Website', href: c.websiteHref }));
    card.innerText = c.lines.join('\n');
    if (c.onClick) a.onclick = c.onClick;
    c.anchor = a;
    c.card = card;
  });
  return feed;
}

// Build an onclick for a card anchor that "opens" a mock detail panel:
// div[role=main][aria-label=name] + data-item-id buttons + Close button.
// info: { dead: true } -> nothing happens (panel-timeout path).
// info: { phoneText, phoneAria, website, address, addressNoAria }
function panelOpener(env, closeButtons) {
  var mockdom = require('./mockdom.js');
  return function () {
    var name = this.getAttribute('aria-label');
    var info = env.places[this.href.split('?')[0]] || {};
    if (info.dead) return;
    var main = new mockdom.MockElement('div', { role: 'main', 'aria-label': name });
    env.document.body.appendChild(main);
    env.panelMain = main;
    if (info.phoneText != null) {
      var b = new mockdom.MockElement('button', { 'data-item-id': 'phone:tel:000' });
      b.innerText = info.phoneText;
      main.appendChild(b);
    }
    if (info.phoneAria != null) {
      var b2 = new mockdom.MockElement('button', { 'data-item-id': 'phone:tel:001', 'aria-label': info.phoneAria });
      main.appendChild(b2);
    }
    if (info.website) {
      main.appendChild(new mockdom.MockElement('a', { 'data-item-id': 'authority:https://x', href: info.website }));
    }
    if (info.address != null) {
      var attrs = { 'data-item-id': 'address' };
      if (!info.addressNoAria) attrs['aria-label'] = 'Address: ' + info.address;
      var ab = new mockdom.MockElement('button', attrs);
      ab.innerText = info.address;
      main.appendChild(ab);
    }
    var closeBtn = new mockdom.MockElement('button', { 'aria-label': 'Close' });
    closeBtn.onclick = function () {
      env.document.body.removeChild(main);
      env.document.body.removeChild(closeBtn);
    };
    env.document.body.appendChild(closeBtn);
    if (closeButtons) closeButtons.push(closeBtn);
  };
}

module.exports = { load: load, shrinkTimers: shrinkTimers, start: start, stop: stop,
  waitFor: waitFor, assert: assert, msgOf: msgOf, buildFeed: buildFeed,
  panelOpener: panelOpener };

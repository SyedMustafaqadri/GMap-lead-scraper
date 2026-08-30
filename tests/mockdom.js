'use strict';
// Minimal DOM mock for GMLE Node tests. Supports only the selector shapes the
// extension uses: `tag`, `tag[attr="v"]`, `tag[attr^="v"]`, `tag[attr*="v"]`.
// (No classes/ids/nesting combinators — GMLE hooks are aria/role/data-*, D-004.)

function MockElement(tag, attrs) {
  this.tagName = String(tag || 'div').toUpperCase();
  this.attributes = {};
  this.children = [];
  this.parentElement = null;
  this.scrollTop = 0;
  this.scrollHeight = 10000;
  this.clientHeight = 600;
  this.innerText = '';
  this.onclick = null;
  this.__clicked = false;
  if (attrs) for (var k in attrs) this.setAttribute(k, attrs[k]);
}

MockElement.prototype.setAttribute = function (k, v) {
  this.attributes[k] = String(v);
  if (k === 'href') this.href = String(v);
};

MockElement.prototype.getAttribute = function (k) {
  return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
};

MockElement.prototype.appendChild = function (c) {
  c.parentElement = this;
  this.children.push(c);
  return c;
};

MockElement.prototype.removeChild = function (c) {
  var i = this.children.indexOf(c);
  if (i >= 0) this.children.splice(i, 1);
  if (c) c.parentElement = null;
  return c;
};

MockElement.prototype.click = function () {
  this.__clicked = true;
  if (typeof this.onclick === 'function') this.onclick({ preventDefault: function () {} });
};

MockElement.prototype.closest = function (sel) {
  var parsed = parseSelector(sel);
  var el = this;
  while (el) {
    if (matches(el, parsed)) return el;
    el = el.parentElement;
  }
  return null;
};

// Record dispatched events (and honor on<type> handlers) so keyboard
// dismissal can be simulated; events bubble to ancestors like real DOM.
MockElement.prototype.dispatchEvent = function (ev) {
  var el = this;
  while (el) {
    el.__events = el.__events || [];
    el.__events.push(ev);
    if (typeof el['on' + ev.type] === 'function') el['on' + ev.type](ev);
    el = el.parentElement;
  }
  return true;
};

MockElement.prototype._walk = function (fn) {
  fn(this);
  for (var i = 0; i < this.children.length; i++) this.children[i]._walk(fn);
};

MockElement.prototype.querySelectorAll = function (sel) {
  var out = [];
  var self = this;
  String(sel).split(',').forEach(function (part) {
    var parsed = parseSelector(part);
    self._walk(function (e) { if (e !== self && matches(e, parsed)) out.push(e); });
  });
  return out;
};

MockElement.prototype.querySelector = function (sel) {
  return this.querySelectorAll(sel)[0] || null;
};

var ATTR_RE = /\[([a-zA-Z-]+)(\*=|\^=|=)"([^"]*)"\]/g;

function parseSelector(sel) {
  var m = /^([a-zA-Z][a-zA-Z0-9-]*)?((?:\[[^\]]+\])+)$/.exec(String(sel).trim());
  if (!m || (!m[1] && !m[2])) throw new Error('mockdom: unsupported selector "' + sel + '"');
  var attrs = [], a;
  ATTR_RE.lastIndex = 0;
  while ((a = ATTR_RE.exec(m[2] || ''))) attrs.push({ name: a[1], op: a[2], value: a[3] });
  return { tag: m[1] ? m[1].toLowerCase() : null, attrs: attrs };
}

function matches(el, parsed) {
  if (parsed.tag && el.tagName.toLowerCase() !== parsed.tag) return false;
  for (var i = 0; i < parsed.attrs.length; i++) {
    var want = parsed.attrs[i];
    var have = el.getAttribute(want.name);
    if (have == null) return false;
    if (want.op === '=' && have !== want.value) return false;
    if (want.op === '^=' && have.indexOf(want.value) !== 0) return false;
    if (want.op === '*=' && have.indexOf(want.value) === -1) return false;
  }
  return true;
}

function MockDocument() {
  MockElement.call(this, '#document');
  this.body = this.appendChild(new MockElement('body'));
  this.hidden = false;
  var self = this;
  this.querySelectorAll = function (sel) {
    var out = [];
    String(sel).split(',').forEach(function (part) {
      var parsed = parseSelector(part);
      self._walk(function (e) { if (matches(e, parsed)) out.push(e); });
    });
    return out;
  };
  this.querySelector = function (sel) {
    var r = self.querySelectorAll(sel);
    return r[0] || null;
  };
}
MockDocument.prototype = Object.create(MockElement.prototype);

module.exports = { MockElement: MockElement, MockDocument: MockDocument };

self.GMLE = self.GMLE || {};

GMLE.extractors = {
  fromAnchor: function (a) {
    var card = GMLE.selectors.cardOf(a);
    var lines = this._lines(card);
    var name = lines.length ? lines[0] : null;
    var ratingObj = this._rating(card);
    // Lines joined with newline so the phone matcher can work per line —
    // the phone occupies its own card line, which keeps it from gluing to
    // adjacent street numbers.
    var text = lines.join('\n');
    // Most reliable hook: tel: link, when the card exposes one.
    var telEl = card ? card.querySelector('a[href^="tel:"]') : null;
    var phone = telEl
      ? (telEl.getAttribute('href') || '').replace(/^tel:/i, '').replace(/[^\d+]/g, '') || null
      : null;
    if (!phone) phone = this._phoneFromText(text);

    var candidates = lines.slice(1).filter(function (l) {
      if (l === name) return false;
      if (l === ratingObj._line) return false;
      if (/^[\d.()\s]+$/.test(l)) return false;
      return true;
    });

    var statusLine = null;
    for (var i = 0; i < candidates.length; i++) {
      if (/\b(open|closed|opens|open 24)\b/i.test(candidates[i])) { statusLine = candidates[i]; break; }
    }
    if (statusLine) {
      var sp = this._phoneFromText(statusLine);
      if (sp) phone = phone || sp;
      candidates = candidates.filter(function (l) { return l !== statusLine; });
    }

    var category = null, address = null;
    candidates.forEach(function (l) {
      var parts = l.split('·').map(function (p) {
        return p.replace(/[★☆\uE000-\uF8FF]/g, '').trim();
      }).filter(function (p) { return p; });
      if (parts.length >= 2) {
        if (!category) category = parts[0];
        if (!address) address = parts[parts.length - 1];
      } else if (parts.length === 1) {
        var s = parts[0];
        if (GMLE.extractors._looksLikeAddress(s)) { if (!address) address = s; }
        else { if (!category) category = s; }
      }
    });

    return {
      name: name,
      phone: phone,
      website: GMLE.selectors.websiteOf(card),
      rating: ratingObj.rating,
      reviews: ratingObj.reviews,
      category: category,
      address: address,
      mapsUrl: (a.href || '').split('?')[0]
    };
  },

  _lines: function (card) {
    if (!card) return [];
    return (card.innerText || '')
      .replace(/[★☆\uE000-\uF8FF]/g, ' ')
      .split('\n')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s; });
  },

  _rating: function (card) {
    if (!card) return { rating: null, reviews: null, _line: null };
    var el = card.querySelector('[aria-label*="stars"]');
    var rating = el ? (el.getAttribute('aria-label').match(/([\d.]+)/) || [])[1] : null;
    var m = (card.innerText || '').match(/([\d.]+)\s*\(([\d,]+)\)/);
    if (m) {
      if (!rating) rating = m[1];
      return { rating: rating, reviews: m[2].replace(/,/g, ''), _line: m[0] };
    }
    return { rating: rating, reviews: null, _line: null };
  },

  _phoneFromText: function (text) {
    if (!text) return null;
    // International-tolerant: optional country code, optional area-code parens
    // or leading-0 trunk prefix, then a greedy digit run with up to 3
    // separator splits. Validated by digit count (7–15) to reject ratings,
    // hours, and address numbers. Matched per line; a '+' form always wins.
    var re = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?|\b0\d{1,3}[\s.-]?)?\d{2,12}(?:[\s.-]\d{2,12}){0,3}/g;
    var fallback = null;
    var linesArr = text.split('\n');
    for (var i = 0; i < linesArr.length; i++) {
      var m;
      re.lastIndex = 0;
      while ((m = re.exec(linesArr[i]))) {
        var digits = m[0].replace(/\D/g, '');
        if (digits.length < 7 || digits.length > 15) continue;
        var cand = m[0].replace(/[^\d+]/g, '');
        if (m[0].charAt(0) === '+') return cand;
        if (!fallback) fallback = cand;
        break; // one candidate per line is enough
      }
    }
    return fallback;
  },

  _looksLikeAddress: function (s) {
    if (/(st|street|road|rd|ave|avenue|lane|ln|sector|extension|town|round about|chowrangi|ground|plot|block|phase|scheme|society|colony|bhai|pura)/i.test(s)) return true;
    if (/,\s/.test(s)) return true;
    if (/\b\d{1,3}[a-z]?\b[\s,]/.test(s)) return true;
    if (/\d/.test(s) && /[a-z]/i.test(s) && s.length > 10) return true;
    return false;
  }
};

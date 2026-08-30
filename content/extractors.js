self.GMLE = self.GMLE || {};

GMLE.extractors = {
  fromAnchor: function (a) {
    var card = GMLE.selectors.cardOf(a);
    // Sponsored cards are ads: their "website" link is an /aclk? redirect and
    // their data is not the business's. Skip the whole card (D-004 hooks).
    if (card && card.querySelector('h1[aria-label="Sponsored"]')) return null;
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

    // Classify per PART (each info line is "part · part · part"), not per
    // line: the restaurant layout joins rating+price on one line
    // ("4.7(4,699) · Rs 1,000–7,000") and drops the phone line entirely, so
    // line-level filters leaked "4.7(4,699)" into Category and "Rs 1,000–7,000"
    // into Address (2026-08-30 live run).
    var category = null, address = null, statusPhone = null;
    for (var i = 1; i < lines.length; i++) {
      var parts = lines[i].split('·').map(function (p) {
        return p.replace(/[★☆\uE000-\uF8FF]/g, '').trim();
      }).filter(function (p) { return p; });
      var hasStatus = parts.some(function (p) { return GMLE.extractors._isStatusPart(p); });
      for (var j = 0; j < parts.length; j++) {
        var p = parts[j];
        if (p === name) continue;
        if (this._isNoisePart(p)) {
          if (hasStatus && !statusPhone) {
            // Clinic layout: the status line is "Closed · Opens 10 AM · <phone>"
            // — the phone is the non-status remainder of that line.
            statusPhone = this._phoneFromText(p) || statusPhone;
          }
          continue;
        }
        if (hasStatus && !statusPhone) {
          var ph = this._phoneFromText(p);
          if (ph) { statusPhone = ph; continue; }
        }
        if (this._looksLikeAddress(p)) { if (!address) address = p; }
        else if (!category) category = p;
      }
    }
    if (!phone) phone = statusPhone;
    if (!phone) phone = this._phoneFromText(text);

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

  // Structured, stable hook: span[role="img"][aria-label="4.7 stars 243 Reviews"].
  // Falls back to the text form "4.7(243)" for older layouts.
  _rating: function (card) {
    if (!card) return { rating: null, reviews: null, _line: null };
    var rating = null, reviews = null;
    var el = card.querySelector('span[role="img"][aria-label*="stars"]');
    if (el) {
      var al = el.getAttribute('aria-label') || '';
      rating = (al.match(/([\d.]+)\s*stars?/i) || [])[1] || null;
      var rm = al.match(/([\d,]+)\s*reviews?/i);
      if (rm) reviews = rm[1].replace(/,/g, '');
    }
    var m = (card.innerText || '').match(/([\d.]+)\s*\(([\d,]+)\)/);
    if (m) {
      if (!rating) rating = m[1];
      if (!reviews) reviews = m[2].replace(/,/g, '');
      return { rating: rating, reviews: reviews, _line: m[0] };
    }
    return { rating: rating, reviews: reviews, _line: null };
  },

  _isRatingPart: function (p) {
    if (!p) return false;
    return /^\d(\.\d+)?\s*\(([\d,]+)\)$/.test(p) ||   // 4.7(4,699)
      /^\(([\d,]+)\)$/.test(p) ||                     // (4,699)
      /^\d(\.\d+)?$/.test(p);                         // 4.7
  },

  _isStatusPart: function (p) {
    return /\b(open|closed|opens|closes|open 24)\b/i.test(p || '');
  },

  _isNoisePart: function (p) {
    if (!p) return true;
    if (this._isRatingPart(p)) return true;
    if (/^[\d.,()\s]+$/.test(p)) return true;         // pure numbers
    if (/^(rs|pkr|usd|aed|inr|eur|\$|€|£|₹)\s?[\d,]/i.test(p)) return true; // price ranges
    if (/["“”]/.test(p)) return true;                 // quoted review snippets
    if (/(family-?friendly|dine-?in|take-?away|takeaway|curbside pickup|drive-?through|outdoor seating|no-contact delivery|group-?friendly|kid-?friendly|wheelchair)/i.test(p)) return true; // attribute chips
    if (this._isStatusPart(p)) return true;           // Open / Closed / Opens… / Closes…
    if (/^(directions|website|save|share|nearby|call)$/i.test(p)) return true; // action-button labels
    return false;
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
    if (/\b(st|street|road|rd|ave|avenue|lane|ln|sector|extension|town|round about|chowrangi|ground|plot|block|phase|scheme|society|colony|bhai|pura)\b/i.test(s)) return true;
    if (/,\s/.test(s)) return true;
    if (/\b\d{1,3}[a-z]?\b[\s,]/.test(s)) return true;
    if (/\d/.test(s) && /[a-z]/i.test(s) && s.length > 10) return true;
    return false;
  }
};

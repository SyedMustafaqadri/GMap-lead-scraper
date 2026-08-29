self.GMLE = self.GMLE || {};

GMLE.selectors = {
  appRoot: '[aria-label="Google Maps"]',
  feed: '[role="feed"]',
  placeLinks: 'a[href*="/maps/place/"]',
  phoneLinks: 'a[href^="tel:"]',

  cardOf: function (a) {
    var feed = document.querySelector(this.feed);
    var el = a;
    var g = 0;
    while (el && g++ < 25) {
      if (feed && el.parentElement === feed) return el;
      if (!el.parentElement) return el;
      el = el.parentElement;
    }
    return a;
  },

  websiteOf: function (card) {
    if (!card) return null;
    var links = card.querySelectorAll('a[href^="http"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      try {
        var u = new URL(a.href);
        var isGoogle = /(^|\.)google\.[a-z]{2}$|(^|\.)google\.[a-z]{2}\.[a-z]{2}$/.test(u.hostname);
        if (!isGoogle && u.pathname.indexOf('/maps/place/') === -1 &&
            u.pathname.indexOf('/maps/dir/') === -1) {
          return a.href;
        }
      } catch (e) {}
    }
    return null;
  }
};

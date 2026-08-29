self.GMLE = self.GMLE || {};

GMLE.config = {
  checkpointLeads: 20,
  checkpointSeconds: 10,
  enrichment: {
    concurrency: 5,
    timeoutMs: 8000,
    maxPages: 3
  },
  scroll: {
    // Humanized pacing — sized from HAR analysis of a healthy manual session
    // (pagination every ~6-10s, single-flight). v2 tuning: the scroll still
    // reaches the actual bottom (that IS the pagination trigger) but steps in
    // smoothly and only scrolls again once the next page has landed.
    minDelayMs: 1500,
    maxDelayMs: 3500,
    readPauseEveryMin: 8,
    readPauseEveryMax: 14,
    readPauseMinMs: 3000,
    readPauseMaxMs: 6000,
    changeWaitPollMs: 300,
    changeWaitMinMs: 5000,
    changeWaitMaxMs: 8000,
    stallCooldownAfter: 3,
    stallCooldownMs: 20000,
    maxConsecutiveNoNew: 8,
    stepMin: 0.8,
    stepMax: 1.5,
    idleTimeoutMs: 300000
  },
  captchaPollMs: 2000,
  debug: {
    eventBufferSize: 300,
    logBufferSize: 300
  }
};

GMLE.FIELDS = [
  { key: 'name', label: 'Business Name', def: true },
  { key: 'category', label: 'Category', def: true },
  { key: 'rating', label: 'Rating', def: true },
  { key: 'reviews', label: 'Review Count', def: true },
  { key: 'address', label: 'Address', def: true },
  { key: 'phone', label: 'Phone', def: true },
  { key: 'website', label: 'Website', def: true },
  { key: 'email', label: 'Email', def: false },
  { key: 'mapsUrl', label: 'Google Maps URL', def: true }
];

GMLE.DEMO_MODE = false;
GMLE.DEV_MODE = false;

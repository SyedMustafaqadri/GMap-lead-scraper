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
    // (pagination every ~6-10s, single-flight, partial scrolls). Pinning to
    // the absolute bottom at a fixed 1.2s cadence wedges Maps' feed loader
    // after ~50-60 leads.
    minDelayMs: 2500,
    maxDelayMs: 5500,
    readPauseEveryMin: 5,
    readPauseEveryMax: 9,
    readPauseMinMs: 4000,
    readPauseMaxMs: 9000,
    changeWaitPollMs: 500,
    changeWaitMinMs: 8000,
    changeWaitMaxMs: 12000,
    stallCooldownAfter: 3,
    stallCooldownMs: 25000,
    maxConsecutiveNoNew: 8,
    bottomMarginMin: 0.15,
    bottomMarginMax: 0.35,
    stepMin: 0.6,
    stepMax: 1.2,
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

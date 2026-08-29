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
    afterScrollMs: 1200,
    maxConsecutiveNoNew: 40,
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

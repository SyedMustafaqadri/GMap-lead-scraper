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
    // Humanized pacing — sized from HAR analysis of a healthy manual session.
    // 2026-08-30 v3 (slower): the fast pace loaded ~10 pages then Google's
    // feed loader hung on its spinner while the loop counted dead cycles and
    // ended the job early. Now: slower cycles, smaller steps, and when the
    // feed is at the bottom or shows a loading spinner the wait budget is
    // much longer (a page is in flight, not missing).
    minDelayMs: 2500,
    maxDelayMs: 5000,
    readPauseEveryMin: 6,
    readPauseEveryMax: 10,
    readPauseMinMs: 4000,
    readPauseMaxMs: 8000,
    changeWaitPollMs: 250,
    changeWaitMinMs: 4000,
    changeWaitMaxMs: 6000,
    // At the bottom / spinner visible: wait much longer for the next page.
    bottomWaitMinMs: 10000,
    bottomWaitMaxMs: 20000,
    // A continuously visible spinner is "page in flight": dead cycles are
    // not counted until it has hung for this long total.
    loadingGiveUpMs: 90000,
    // Before giving up on 'no-results', give the feed one last window to
    // settle (spinner clears / end-of-list appears / more results arrive).
    endConfirmTimeoutMs: 60000,
    stallCooldownAfter: 3,
    stallCooldownMs: 30000,
    maxConsecutiveNoNew: 8,
    stepMin: 0.6,
    stepMax: 0.9,
    idleTimeoutMs: 300000
  },
  captchaPollMs: 2000,
  // Content -> SW keepalive round trip while a job is running. Chrome
  // suspends the SW after ~30s idle; with a visible tab the loop's waits
  // are local timers, so without this the SW can die mid-run.
  pingIntervalMs: 20000,
  // Phase 2 (detail-panel visiting): after the feed is exhausted, each lead
  // missing phone/website gets a card click → panel scrape cycle. Panels are
  // NEVER closed between visits (the Close button's jsaction handler resets
  // Maps to the landing state) — the next card click swaps the panel content
  // in place; one courtesy Escape runs after DONE, when nothing is at stake.
  visit: {
    panelTimeoutMs: 8000,       // wait for the detail panel to open/swap
    feedReadyTimeoutMs: 15000,  // extra wait before starting visits on a busy feed
    delayMinMs: 2000,           // random 2-4s between visits (human-like)
    delayMaxMs: 4000
  },
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

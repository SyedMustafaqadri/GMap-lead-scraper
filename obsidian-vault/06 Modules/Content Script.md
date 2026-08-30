---
type: module
created: 2026-08-30
status: active
---

# Content Script (content/)

> DOM scraping + extraction loop. Runs on `www.google.com` (see `manifest.json` `content_scripts`: config, messaging, dedupe, debug, storage, stateMachine, selectors, extractors, content). Vanilla ES5-style classic scripts on the `self.GMLE` namespace.

## Responsibilities
- **Phase 1 — scroll + extract** (`content/content.js` loop): humanized single-flight scrolling of `[role="feed"]` to the bottom (the pagination trigger), `waitForFeedChange` grow-or-shrink detection, reading pauses, stall cooldown, feed-lost waiting, CAPTCHA pause/resume, end-of-results detection. Extraction via `content/extractors.js` on stable hooks only ([[03 Decisions/Decision Log|D-004]]); dedupe locally (`seenLocal`) and via SW fingerprints; batches posted as `LEADS_DISCOVERED`.
- **Slow-feed patience (2026-08-30 round 2):** `feedSpinner()` (`[role="progressbar"]`/`[aria-busy="true"]`/Loading text at the feed tail) + `atBottom()` switch the loop to long 10–20 s wait budgets; a visible spinner is "page in flight" — no dead cycles until it hangs 90 s (`loadingGiveUpMs`); no scrolling while loading. The `no-results` path gets a 60 s `waitFeedSettle` window: end-marker → phase 2, anchor growth → `feed-recovered-resume` (resume scrolling), else `phase2-skipped-feed-unhealthy` + graceful DONE.
- **Phase 2 — detail-panel visiting** (added 2026-08-30, [[03 Decisions/Decision Log|D-007]]): after the feed is exhausted, leads missing phone/website (per selected fields) are visited one by one: health gate (never click into a busy/dead feed) → find card anchor by mapsUrl prefix → `anchor.click()` (SPA) → wait for panel (`div[role="main"]` aria-label = place name, and/or `button[data-item-id="address"]`, 8 s) → scrape phone `button[data-item-id^="phone"]` / website `a[data-item-id^="authority"]` / full address `button[data-item-id="address"]` → `button[aria-label="Close"]` → wait for the feed back **healthy** (`waitFeedBack`: present + anchors + no spinner, 20 s; if not restored, abort remaining visits with `phase2-feed-not-restored` and still DONE) → 2–4 s jitter → next. Posts `LEADS_ENRICHED` per visit + `phase2-*` DIAG traces. DONE only after the queue drains (`endOfFeed`/`finishNow`); STOP drops the queue.
- **Hidden-tab safety:** all loop timers go through `gmSleep()` — visible tabs use `setTimeout`, hidden tabs delegate to the SW (`SCHEDULE_TICK`/`LOOP_TICK` round trip) because Chrome throttles hidden-tab timers to ~1/min.
- **Liveness:** answers `CHECK_JOB` with `JOB_ACK` only when actually running that jobId (stale-job detection after SW/browser restarts).

## Key invariants
- Never navigate via `location.href` — SPA clicks only, or the content script dies.
- `GMLE.post` (runtime.sendMessage) reaches the SW only; the SW relays UI pushes tab-targeted.
- Sponsored cards (`h1[aria-label="Sponsored"]`) are skipped wholesale (their website link is an `/aclk` ad redirect).

## DOM hooks in use (aria/role/data-* only)
Feed: `[role="feed"]`, `a[href*="/maps/place/"]`, `a[href^="tel:"]`, `span[role="img"][aria-label*="stars"]`, `a[data-value="Website"]`. Panel: `button[data-item-id="address"]`, `button[data-item-id^="phone"]`, `a[data-item-id^="authority"]`, `button[aria-label="Close"]`. Full reference: [[02 Architecture/Maps DOM Reference]].

## Verification
- ✅ Mocked-DOM Node tests: `node tests/test-extractors.js`, `node tests/test-panel.js`, `node tests/test-phase2.js` (mock DOM in `tests/mockdom.js`).
- ⬜ Live: restaurant search (clean Category/Address + populated Phone/Website) and clinic regression — pending user run.

## Related
- [[02 Architecture/Components]], [[06 Modules/Service Worker]], [[02 Architecture/Maps DOM Reference]]

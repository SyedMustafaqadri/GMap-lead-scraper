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
- **Phase 2 — detail-panel visiting** (added 2026-08-30, [[03 Decisions/Decision Log|D-007]]): after the feed is exhausted, leads missing phone/website (per selected fields) are visited one by one: health gate (never click into a busy/dead feed) → find card anchor by mapsUrl prefix → `anchor.click()` (SPA) → wait for panel (`div[role="main"]` aria-label = place name, and/or `button[data-item-id="address"]`, 8 s) → scrape phone `button[data-item-id^="phone"]` / website `a[data-item-id^="authority"]` / full address `button[data-item-id="address"]` → **verified dismissal chain** → 2–4 s jitter → next. Posts `LEADS_ENRICHED` per visit + `phase2-*` DIAG traces. DONE only after the queue drains (`endOfFeed`/`finishNow`); STOP drops the queue.
- **Close-less visiting (2026-08-31 round 5, user's idea):** the native Close button's jsaction handler `history.back()`s past the search entry and resets Maps to the landing state (verified twice live; Escape and the outer jsaction span were also verified to NOT work on the live page). So panels are **never closed mid-run**: the feed stays alive in the DOM behind the open panel, and clicking the next card's anchor swaps the panel content in place (place-to-place SPA navigation pushes forward in history). `findPanel` matches the panel by place name (name-only — the address-button heuristic false-positives during swaps); `scrapePanel(lead)` is scoped to the lead's own panel so lingering data can't leak. After DONE + export, one courtesy Escape runs (fire-and-forget — Maps ignores synthetic Escape, so the last panel may stay open). Safety net: a card-not-found with a dropped route OR an empty feed shell aborts via `phase2-search-reset`. Opening a place still pans the map to it — that is Google-native behavior, identical to a human click.- **Hidden-tab safety:** all loop timers go through `gmSleep()` — visible tabs use `setTimeout`, hidden tabs delegate to the SW (`SCHEDULE_TICK`/`LOOP_TICK` round trip) because Chrome throttles hidden-tab timers to ~1/min.
- **SW keepalive / connection watchdog (2026-08-30 round 3):** while a job runs, a `pingLoop` posts `PING` every 20 s; the SW answers `PONG` (both excluded from the debug trace). The round trip resets the SW 30 s idle timer so it never suspends mid-run (a suspension silently swallowed every message on the Kansas City run and killed Stop). No PONG for 60 s → console warning + `ERROR` relayed to the overlay. Send failures in `GMLE.post` are logged, never swallowed.
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

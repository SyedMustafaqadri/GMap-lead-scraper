---
type: task
created: 2026-08-26
status: active
---

# Backlog

## Immediate next step (Specs.md §53)
- [x] Inspect real Google Maps DOM in Chrome; capture: business card, results container, scroll container, phone/website/category/rating/address elements (see [[05 Pitfalls/Do Not Guess DOM]]).
  - Partial: one truncated dump analyzed → [[02 Architecture/Maps DOM Reference]], [[03 Decisions/Decision Log|D-004]]. Still need full card + scroll + end-of-results + CAPTCHA markers.
- [ ] Round 4B detailed technical architecture: folder structure ✅ (in Architecture Map), Manifest V3, side-panel / content-script / service-worker design, message types, state machine, lead data model, IndexedDB schema, dedupe algorithm, scrolling algorithm, DOM observation strategy, enrichment queue, concurrency model, checkpoint strategy, XLSX generation, error & CAPTCHA handling, job isolation, config system, testing strategy.

## Pending technical investigation (§52)
- [x] Actual DOM structure & containers — stable hooks found (`[aria-label="Google Maps"]`, `[role="feed"]`, `/maps/place/`).
- [ ] Scrollable container & card structure — class names obfuscated; need fuller capture.
- [ ] Available business identifiers (dedupe) — Maps URL (`/maps/place/`) + itemprop available.
- [ ] Phone / Website / Category / Rating / Review / Address elements — `tel:`, non-google links, itemprop available; exact card layout TBD.
- [ ] Loading indicators & end-of-results behavior — TBD.
- [ ] CAPTCHA / intervention indicators — TBD.
- [x] Required Chrome permissions & host permissions — `activeTab`, `sidePanel`, `storage`, `scripting`; host `*.google.com/*` + `<all_urls>` for enrichment.
- [x] IndexedDB vs chrome.storage split — decided (Data Model).
- [x] XLSX library compatible with MV3 — SheetJS vendored in `lib/`.
- [ ] Practical enrichment concurrency limits — default 5 (configurable), to tune live.

## Implementation (in progress)
- [x] Extension scaffold / folder structure
- [x] Manifest V3
- [x] Side Panel UI (superseded by [[06 Modules/Overlay UI]], D-005)
- [x] Content Script extraction (on stable hooks, best-effort)
- [x] Service Worker orchestration
- [x] IndexedDB persistence
- [x] Deduplication
- [x] Enrichment workers
- [x] XLSX export (in panel)
- [x] Two-phase detail scraping (panel visits for phone/website/address) + per-part card classification — 2026-08-30, commit `cd2ad1c`; see [[06 Modules/Content Script]], [[03 Decisions/Decision Log|D-007]]
- [x] Node mocked-DOM test suites (`tests/`, run with `node tests/test-<name>.js`)
- [ ] Load unpacked in Chrome + fix any load/runtime errors
- [ ] Demo-mode pipeline test (set `GMLE.DEMO_MODE=true`)
- [ ] Live-Maps verification: restaurant run (clean Category/Address, populated Phone/Website) + clinic regression + DONE-waits-for-visits

## Related
- [[01 Project State/Project State]]
- [[01 Project State/Session Log]]
- [[02 Architecture/Maps DOM Reference]]

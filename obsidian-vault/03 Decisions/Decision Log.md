---
type: decision-log
created: 2026-08-26
status: active
---

# Decision Log

> Append-only. New decisions get the next `D-0XX` number with rationale. Do not edit/delete old entries.

## D-001 — Adaptive scrolling + hybrid DOM observation
- **Date:** 2026-08-26
- **Rationale:** Google Maps is a complex dynamic app; fixed-speed scrolling risks missed results and instability, and MutationObserver alone is insufficient. Hybrid (observer + polling + scroll/loading detection) is more robust (spec §13–§14). DOM recycles cards, so extraction must copy into our own dataset (§19).
- **Related:** [[02 Architecture/Architecture Map]], [[05 Pitfalls/Do Not Guess DOM]]

## D-002 — Explicit extraction state machine
- **Date:** 2026-08-26
- **Rationale:** Lifecycle must be explicit (IDLE→…→COMPLETED) with CAPTCHA/ERROR/PAUSED states. Recovery is "pause and preserve data," never auto-refresh Maps (spec §34–§37, §51). Sidebar close stops extraction but checkpointed data is safe (§40).
- **Related:** [[02 Architecture/Components]]

## D-003 — Hierarchical lead deduplication
- **Date:** 2026-08-26
- **Rationale:** Single-field matching is unreliable. Use priority chain: stable Place id → Maps URL → normalized phone+name → name+address (spec §18). Exact identifier availability must be verified from real DOM.
- **Related:** [[02 Architecture/Data Model]], [[05 Pitfalls/Do Not Guess DOM]]

## D-004 — Use stable DOM hooks, never minified class names
- **Date:** 2026-08-26
- **Rationale:** Captured `html-DOM.md` proves Google Maps ships Closure-compiler minified, rotating CSS classes (e.g. `.Ymd7jc`, `.UW56ye`). Selecting on those breaks across builds. All extraction must rely on stable attributes: `document.title` search query, `[aria-label="Google Maps"]` root, `[role="feed"]` list, `a[href*="/maps/place/"]` + `a[href^="tel:"]` + non-google `http(s)` links, and `itemprop` microdata. Centralize in `content/selectors.js`; wrap each field in try/catch and leave blank on failure (spec §30).
- **Related:** [[02 Architecture/Maps DOM Reference]], [[05 Pitfalls/Do Not Guess DOM]], [[02 Architecture/Components]]

## D-005 — Floating overlay panel replaces the side panel (V2 UI)
- **Date:** 2026-08-29
- **Rationale:** Side panel overlaps the browser chrome and is inconvenient next to Maps' own left sidebar. The UI is now a content-script-injected floating panel fixed top-right (Shadow DOM for two-way style isolation), collapsible into a small trigger button. Appears **only after toolbar click** (user choice) with a `chrome.scripting.executeScript` fallback for tabs opened before install/reload. Export moved to the service worker (content scripts have no `chrome.downloads`; also drops the 882 KB SheetJS lib from the page context). Tab close/navigation stops the job via `pagehide` (spec §40 remapped; collapsing the panel does NOT stop extraction). This supersedes spec §38/§40's side-panel semantics; UX simplicity principle (§50) kept.
- **Related:** [[06 Modules/Overlay UI]], [[02 Architecture/Components]]

## D-006 — Dev debug section gated by config flag, fed by an SW trace tap
- **Date:** 2026-08-29
- **Rationale:** Developer needs real-time state, background event tracing, and execution logs without shipping debug UI to regular users. Chosen: `GMLE.DEV_MODE` flag in `modules/config.js` (no UI toggle, user choice). `modules/messaging.js` exposes an optional trace tap recording every send/recv; the service worker (the hub of all traffic) owns ring buffers in `modules/debug.js` (300 events / 300 logs) and streams them to the overlay debug drawer via tab-targeted `DEBUG_*` messages while the drawer is open (backlog flushed on open). Runtime broadcasts don't reach content scripts, so all UI pushes are tab-targeted.
- **Related:** [[06 Modules/Debug]], [[02 Architecture/Components]]

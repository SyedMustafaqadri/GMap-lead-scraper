---
type: architecture
created: 2026-08-26
status: seed
---

# Components

## Summary
Three extension pieces, strictly separated by concern: Overlay UI (in-page floating panel), Content Script (Maps DOM), Service Worker (orchestration). See spec §44–§46; the side panel was replaced by the overlay per [[03 Decisions/Decision Log|D-005]] (2026-08-29).

## Details
### Overlay UI (replaces former Side Panel §38/§44)
- UI only; must NOT do DOM extraction. Details in [[06 Modules/Overlay UI]].
- Dormant content script on Maps; builds a Shadow-DOM floating panel top-right on first `OVERLAY_TOGGLE` (toolbar click), collapsible to a trigger button.
- Responsibilities: Start/Stop, settings (persisted), field selection, status/progress display, export button, dev debug drawer (`GMLE.DEV_MODE`).

### Content Script (§44)
- The only component touching the Google Maps DOM for extraction.
- Responsibilities: detect Maps state & search, locate results/scroll container, observe DOM, extract business info, scroll, detect loading/CAPTCHA, report to service worker.
- **Two-phase extraction (2026-08-30, [[03 Decisions/Decision Log|D-007]]):** phase 1 scrolls the feed and extracts cards; phase 2 (after the feed is exhausted) clicks each lead's card and scrapes the opened detail panel (`data-item-id` hooks) for phone/website/full address, posting `LEADS_ENRICHED` per visit. DONE waits until the visit queue drains. Details in [[06 Modules/Content Script]].

### Service Worker (§44)
- Coordination brain.
- Responsibilities: job management, extraction state machine, start/stop, deduplication, persistence coordination, enrichment queue, **XLSX generation + `chrome.downloads`** (moved from the panel in D-005), toolbar-click handling (`chrome.action.onClicked` + executeScript fallback), debug trace hub.

### Message flow (§45, updated 2026-08-30)
- Overlay `START_EXTRACTION` (no tabId — SW uses `sender.tab.id`) → Content `START` → `LEADS_DISCOVERED` → SW (dedupe → persist → enrich) → `STATUS_UPDATE`/`STATE_CHANGED` back to the overlay tab.
- Phase 2: Content `LEADS_ENRICHED {jobId, fp, updates}` per detail-panel visit → SW merges (phone/website fill blanks, address upgrades, [[03 Decisions/Decision Log|D-008]]) → then Content `DONE` (only after the visit queue drains) → SW finalizes + exports.
- Overlay `REQUEST_STATUS` on open → SW rehydrates state. `REQUEST_EXPORT` → SW builds xlsx + downloads.
- **Transport rule:** content scripts never receive `runtime.sendMessage` broadcasts; every UI-facing push uses `tabs.sendMessage` (`GMLE.postToTab`) targeted at the overlay's tab. Debug traffic (`DEBUG_*`) flows only to the tab whose drawer is open.

## Implementation (updated 2026-08-29, vanilla JS MV3, no build)
- **Overlay UI:** `overlay/overlay.js` (dormant controller, `__overlayLoaded` guard), `overlay/overlay.css` (Shadow-DOM styles via `web_accessible_resources`), `overlay/overlayDebug.js` (dev drawer, `GMLE.debugUi`). Content-script list: `modules/{config,messaging,dedupe,debug,storage,stateMachine}.js` + `content/{selectors,extractors,content}.js` + `overlay/{overlayDebug,overlay}.js`.
- **Content Script:** `content/content.js` (loop/scroll/CAPTCHA, `__contentLoaded` guard), `content/selectors.js` (stable hooks — **never minified classes**, [[03 Decisions/Decision Log|D-004]]), `content/extractors.js` (field parsing, best-effort).
- **Service Worker:** `background.js` imports `modules/{config,messaging,debug,stateMachine,dedupe,storage,jobManager,enrichment}.js`; lazy `importScripts` of `lib/xlsx.full.min.js` + `modules/xlsxExport.js` on export.
- **Shared modules:** `modules/{config,messaging,debug,stateMachine,dedupe,storage,jobManager,enrichment,xlsxExport}.js` (classic scripts on `self.GMLE` — no ES modules, runs in SW/content contexts).
- **Persistence:** `modules/storage.js` — IndexedDB (`jobs`, `leads` stores) + `chrome.storage` (`settings` incl. target/fields/UI state, `currentJobId`).
- **Debug core:** `modules/debug.js` — ring buffers + trace tap; SW streams to overlay (see [[06 Modules/Debug]]).
- **Verification:** pure logic (dedupe fingerprint, XLSX base64, filename) unit-tested in Node; all JS passes `node --check`. Browser verification of the V2 overlay pending live Maps run.

## Related
- [[02 Architecture/Architecture Map]]
- [[02 Architecture/Data Model]]
- [[02 Architecture/Maps DOM Reference]]
- [[03 Decisions/Decision Log|D-004]]

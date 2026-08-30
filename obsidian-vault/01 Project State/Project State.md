---
type: project-state
updated: 2026-08-29
status: active
---

# Project State

## Current Objective
V2 UI: replace the side panel with a floating, collapsible overlay panel on Google Maps pages plus a dev-only debug section — implemented; live browser verification pending.

## Current Module / Step
Implementation → [[06 Modules/Overlay UI]] + [[06 Modules/Debug]] complete, awaiting live verification. Extraction-DOM tuning (selectors/extractors) still open from 2026-08-26.

## Completed
- Specs, vault seed, DOM analysis, stable-hook strategy ([[03 Decisions/Decision Log|D-004]]).
- Extension MVP scaffold + field parsing fixes + pipeline fixes (see [[01 Project State/Session Log]], 2026-08-26).
- **2026-08-29 — V2 UI overhaul:** side panel removed; floating Shadow-DOM overlay (`overlay/`) with trigger button; toolbar-click toggle with executeScript fallback; export moved to the service worker (lazy SheetJS); state rehydration via `REQUEST_STATUS`; dev debug drawer (`GMLE.DEV_MODE` flag) with State/Events/Log tabs fed by `modules/debug.js` trace tap; settings persistence. Manifest bumped to 0.2.0. All JS passes `node --check`.

## In Progress
- Live verification of 2026-08-29 fixes: detail-page phone/website enrichment, SW job restore (Stop robustness), feed-lost resilience, category/address cleanup. User to run a real extraction.

## Pending
- User live run: confirm Phone/Website columns fill from detail pages, Stop works mid-run, extraction survives opening a place page / filter changes.
- Live-Maps capture (complete card, scroll container, end-of-results, CAPTCHA markers) → finalize `extractors.js`.

## Blocked
- (none)

## Next Actions
1. User reloads the unpacked extension and runs a real extraction (target ~100).
2. Check CSV: Phone + Website columns populate; Category/Address contain no rating/price/attribute garbage.
3. Mid-run: click Stop (should finalize + export) and open a place page (extraction should resume after returning).

## Last Verified
2026-08-29

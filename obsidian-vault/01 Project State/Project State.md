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
- Nothing in code; awaiting user verification pass.

## Pending
- Load unpacked in Chrome; verify: no load errors, side panel gone, toolbar click toggles overlay on Maps, fallback injection works on pre-existing Maps tabs.
- Demo mode (`GMLE.DEMO_MODE=true` + Demo run in debug drawer) → metrics update → XLSX auto-downloads from SW.
- Reopen panel mid-run shows live progress; tab close stops the job.
- `GMLE.DEV_MODE=true` → debug drawer: State tab matches counters, Events tab traces message flow, Log shows DIAG entries.
- Live-Maps capture (complete card, scroll container, end-of-results, CAPTCHA markers) → finalize `extractors.js`.

## Blocked
- (none)

## Next Actions
1. User loads unpacked extension (v0.2.0) in Chrome; report load errors.
2. Toolbar-click the extension on a Google Maps tab → overlay appears top-right; toggle collapse/expand.
3. Set `GMLE.DEMO_MODE=true`, reload, use Demo run in the debug drawer → confirm XLSX downloads.
4. Provide fuller DOM capture to finalize `extractors.js` (carried over).

## Last Verified
2026-08-29

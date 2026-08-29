---
type: architecture
created: 2026-08-26
status: seed
---

# Architecture Map

## Summary
Private, **local-first Chrome extension (Manifest V3)** that extracts leads from the user's existing Google Maps search and exports them to `.xlsx`. No backend, no accounts, no cloud.

## Architecture style
Local-first Chrome MV3 extension. Three separated concerns: Overlay UI (injected into the Maps page, replaces the former side panel — [[03 Decisions/Decision Log|D-005]]), Content Script (Maps DOM), Service Worker (orchestration + XLSX export). Persistence via IndexedDB + chrome.storage.

## System flow (spec §46, updated 2026-08-29)
GOOGLE MAPS → Content Script (DOM extract / scroll / observe) → Messages → Service Worker (state machine, job mgmt, dedupe, queue, XLSX + downloads) → { IndexedDB, Enrichment Workers, Overlay UI (tab-targeted messages) } → leads.xlsx

## Key decisions
- Chrome-only MVP; Manifest V3 (spec §42–§43).
- No backend unless proven necessary (§47).
- Local-first rationale: privacy, simplicity, no auth/cloud (§48).
- Core UX: Search → Start → Run → Stop/finish → Excel (§54).

## Folder layout
Updated 2026-08-29 (vanilla JS, no build — Specs decision + user choice):
```
manifest.json                 # v0.2.0 — no side_panel; overlay content scripts; WAR for overlay.css
background.js                 # service worker: orchestration + state machine + XLSX export + toolbar toggle + debug hub
overlay/  overlay.js | overlay.css | overlayDebug.js   # floating overlay UI (Shadow DOM) + dev debug drawer
content/  content.js | selectors.js | extractors.js
modules/  config.js messaging.js debug.js stateMachine.js storage.js jobManager.js
         dedupe.js enrichment.js xlsxExport.js
lib/ xlsx.full.min.js         # vendored SheetJS (lazy-imported by the SW on export)
icons/
```
Content extraction uses stable DOM hooks only ([[03 Decisions/Decision Log|D-004]], [[02 Architecture/Maps DOM Reference]]).

## Related
- [[00 Home]]
- [[02 Architecture/Components]]
- [[02 Architecture/Data Model]]
- [[02 Architecture/Maps DOM Reference]]
- [[03 Decisions/Decision Log]]

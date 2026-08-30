# 00 Home — Google Maps Lead Extractor

> Map of Content + Quick Context. Read this first every session. `obsidian-vault/` is the AI coding harness's memory of the project.

## Quick Context
- **Project:** Private Chrome extension (Manifest V3) that extracts Google Maps leads → `.xlsx`.
- **Status:** Two-phase detail scraping + per-part card classification **implemented and mocked-DOM tested** (2026-08-30, commit `cd2ad1c`, local only). Live-Maps verification pending.
- **Current objective:** User live test — restaurant search to ~100 leads (clean Category/Address, populated Phone/Website), clinic regression, DONE-waits-for-visits; then push on user's word.
- **Architecture style:** local-first Chrome MV3 extension (no backend).
- **UI:** `overlay/` module (dormant content script, top-right panel + trigger button); export runs in the service worker; debug via `GMLE.DEV_MODE` flag in `modules/config.js`. See [[06 Modules/Overlay UI]].
- **Extraction:** phase 1 scroll+extract (`content/content.js` loop); phase 2 visits each lead's detail panel via SPA clicks (`data-item-id` hooks) for phone/website/address — the old `fetch()` path was silently intercepted and removed ([[03 Decisions/Decision Log|D-007]]). Tests: `node tests/test-<name>.js` (mock DOM).
- **Source of truth:** `Specs.md` (repo root), until a [[03 Decisions/Decision Log|D-0XX]] decision overturns it (D-005 overturns the side-panel UI parts).
- **Last Verified:** 2026-08-30 (Node test suites; live Maps run pending)

## Map of Content

### Project State
- [[01 Project State/Project State]] — live status, next actions
- [[01 Project State/Session Log]] — dated history (newest first)

### Architecture
- [[02 Architecture/Architecture Map]] — system shape, component graph
- [[02 Architecture/Components]] — Side Panel / Content Script / Service Worker
- [[02 Architecture/Data Model]] — lead schema, IndexedDB, chrome.storage, checkpoints

### Decisions
- [[03 Decisions/Decision Log]] — numbered D-0XX decisions + rationale

### Patterns
- [[04 Patterns/Engineering Principles]] — the 10 principles (spec §50)

### Pitfalls
- [[05 Pitfalls/Do Not Guess DOM]] — inspect real Maps HTML before coding selectors

### Modules (created during dev)
- [[06 Modules/Overlay UI]] — floating overlay panel + trigger button (V2 UI)
- [[06 Modules/Debug]] — dev debug drawer + trace/log core
- [[06 Modules/Content Script]] — scroll loop, card parsing, phase-2 detail visits
- [[06 Modules/Service Worker]] — orchestration, merge, export, watchdog
- `06 Modules/` — remaining component notes (Storage, Enrichment, XLSX) still to be created as worked on

### Risks & Debt
- [[07 Risks & Debt/Risks & Technical Debt]] — known risks, severity, status

### Tasks
- [[08 Tasks/Backlog]] — investigation list + implementation checklist

## How to maintain
See `AGENTS.md` (repo root): read Home first, write as you build, one note per concept, link with `[[wikilinks]]`, follow the mandatory Task Completion Logging Protocol.

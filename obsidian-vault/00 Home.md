# 00 Home — Google Maps Lead Extractor

> Map of Content + Quick Context. Read this first every session. `obsidian-vault/` is the AI coding harness's memory of the project.

## Quick Context
- **Project:** Private Chrome extension (Manifest V3) that extracts Google Maps leads → `.xlsx`.
- **Status:** V2 UI implemented (2026-08-29): floating Shadow-DOM overlay panel replaces the side panel; dev debug drawer added. Live browser verification pending.
- **Current objective:** Verify the V2 overlay end-to-end (load unpacked → toolbar toggle → demo run → debug drawer), then finish live-DOM tuning of `extractors.js`.
- **Architecture style:** local-first Chrome MV3 extension (no backend).
- **UI:** `overlay/` module (dormant content script, top-right panel + trigger button); export runs in the service worker; debug via `GMLE.DEV_MODE` flag in `modules/config.js`. See [[06 Modules/Overlay UI]].
- **Source of truth:** `Specs.md` (repo root), until a [[03 Decisions/Decision Log|D-0XX]] decision overturns it (D-005 overturns the side-panel UI parts).
- **Last Verified:** 2026-08-29

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
- `06 Modules/` — remaining component notes (Content Script, Service Worker, Storage, Enrichment, XLSX) still to be created as worked on

### Risks & Debt
- [[07 Risks & Debt/Risks & Technical Debt]] — known risks, severity, status

### Tasks
- [[08 Tasks/Backlog]] — investigation list + implementation checklist

## How to maintain
See `AGENTS.md` (repo root): read Home first, write as you build, one note per concept, link with `[[wikilinks]]`, follow the mandatory Task Completion Logging Protocol.

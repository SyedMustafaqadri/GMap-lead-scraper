---
type: moc
---

# 00 Home — Google Maps Lead Extractor

> Map of Content + Quick Context. Read this first every session. `obsidian-vault/` is the AI coding harness's memory of the project.

## Quick Context
- **Project:** Private Chrome extension (Manifest V3) that extracts Google Maps leads → `.xlsx`.
- **Status:** Five live-run issues found and fixed across 2026-08-30/31; the latest (Close-button reset) is solved by **close-less visiting** — panels swap in place and are never closed mid-run (user's idea). Latest commit `a5430ee`, local only. Live re-verification pending.
- **Current objective:** User live re-test: every phase-2 visit must close via Escape (`closeMethod: escape` in the Events tab) with the `/maps/search/` route preserved, all visits drain, clean CSV; then push on user's word.
- **Architecture style:** local-first Chrome MV3 extension (no backend).
- **UI:** `overlay/` module (dormant content script, top-right panel + trigger button); export runs in the service worker; debug via `GMLE.DEV_MODE` flag in `modules/config.js`. See [[06 Modules/Overlay UI]].
- **Extraction:** phase 1 scroll+extract with slow-feed patience (`feedSpinner`/`atBottom`, settle window, force-glide to bottom on stall); phase 2 visits each lead's detail panel via SPA clicks and **never closes panels** — the next card click swaps the panel content in place, so the reset-triggering Close handler is never invoked ([[03 Decisions/Decision Log|D-007]], [[06 Modules/Content Script]]). SW↔content link kept alive by a 20 s PING/PONG round trip (R-013). Tests: `node tests/test-<name>.js` (mock DOM).
- **Source of truth:** `Specs.md` (repo root), until a [[03 Decisions/Decision Log|D-0XX]] decision overturns it (D-005 overturns the side-panel UI parts).
- **Last Verified:** 2026-08-31 (Node test suites; live re-run pending)

## Map of Content

### Project State
- [[01 Project State/Project State]] — live status, next actions
- [[01 Project State/Session Log]] — dated history (newest first)

### Architecture
- [[02 Architecture/Architecture Map]] — system shape, component graph
- [[02 Architecture/Components]] — Side Panel / Content Script / Service Worker
- [[02 Architecture/Data Model]] — lead schema, IndexedDB, chrome.storage, checkpoints
- [[02 Architecture/Maps DOM Reference]] — stable DOM hooks (feed cards + detail panel)

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

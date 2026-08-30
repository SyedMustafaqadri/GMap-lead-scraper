---
type: module
created: 2026-08-30
status: active
---

# Service Worker (background.js + modules/)

> Orchestrator. Stateless-ish by design (MV3 kills it at will): jobs are rebuilt from IndexedDB on wake (`ensureJobRestored` with `CHECK_JOB`/`JOB_ACK` liveness — stale jobs are abandoned, live ones restored). Owns export (SheetJS vendored in `lib/`, `chrome.downloads`), email enrichment queue, and the debug trace hub.

## Message handling (highlights)
- `LEADS_DISCOVERED` → `handleLeads`: dedupe by fingerprint, push, checkpoint, `STATUS_UPDATE` to the job's tab; auto-STOP when target reached; queues email enrichment when a website is present.
- `LEADS_ENRICHED` → `handleLeadEnriched`: merge by fingerprint — **phone/website fill blanks only; address is an upgrade (overwrites)** ([[03 Decisions/Decision Log|D-008]]). A newly filled website re-queues email enrichment. Refreshes `job.lastLeadTs` so the 300 s idle watchdog doesn't kill long phase-2 drains (no new leads arrive during detail-panel visiting).
- `DONE` → `finalizeJob`: drains the enrichment queue, final checkpoint, `COMPLETED`, export. Fired by the content script only after its phase-2 visit queue has drained.
- `SCHEDULE_TICK`/`LOOP_TICK` → hidden-tab heartbeat scheduler for the content loop.
- `START_EXTRACTION`/`STOP`/`REQUEST_STATUS`/`REQUEST_EXPORT`/`CHECK_JOB`/`JOB_ACK`/`CAPTCHA`/`RESUMED`/`DEBUG_*` as before.
- All UI-facing pushes go through `GMLE.postToTab` (runtime broadcasts never reach content scripts).

## Timing constants (`modules/config.js`)
- `scroll.*`: humanized pacing (HAR-derived; see 2026-08-29 Session Log entries).
- `visit.*` (2026-08-30): panel open wait 8 s, feed-return wait 15 s, 1–2 s inter-visit delay.

## Verification
- ✅ `node tests/test-sw-merge.js` — merge semantics (fill-blanks vs address upgrade, enrichment re-queue, lastLeadTs refresh, unknown ids tolerated) with in-memory storage/enrichment stubs.
- ⬜ Live: DONE waits for phase-2 visits; export contains panel-filled fields — pending user run.

## Related
- [[02 Architecture/Components]], [[02 Architecture/Data Model]], [[06 Modules/Content Script]], [[06 Modules/Debug]]

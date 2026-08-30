---
type: project-state
updated: 2026-08-30
status: active
---

# Project State

## Current Objective
Live verification round 4: the Sacramento run pulled 123 leads cleanly but the native Close button's jsaction handler reset Maps to the landing state after visit #1 (route fell to `/maps/@lat,lng?entry=ttu`), losing the remaining 30 visits. Fixed via a verified dismissal chain (Escape → outer jsaction span → inner button) that confirms the `/maps/search/` route + feed survive each close (commit `5441ead`, local only).

## Current Module / Step
`content/content.js` phase-2 dismissal reworked: `dismissPanel` tries Escape keydown at the panel first, then the outer `span[jsaction]` wrapper, then the inner button; every attempt is verified (panel closed + feed healthy + route intact, `closeSettleMs` 1.5 s). `closeMethod` is recorded per visit in the `phase2-visit` DIAG. Reset/stuck panels abort the queue cleanly with a DIAG and a DONE so the export still happens.

## Completed
- All fixes through 2026-08-30 (see Session Log): overlay UI v2, slow-feed patience, phase-2 health gates, SW keepalive + unconditional STOP + unknown-job DONE flush, per-part card classification, two-phase detail visiting.
- 2026-08-30 (round 4): Close-button SPA reset bypassed via verified dismissal chain; scenario 8 covers the Escape-unresponsive fallback; scenario 7 asserts close-reset abort.

## In Progress
- Nothing in code — awaiting live verification.

## Pending
- User live verification round 4: `closeMethod: escape` (or `span`) on every visit in the Events tab, search route preserved across all visits, all visits drain, clean CSV.
- Note: the Sacramento run reached 123 leads — the single-search cap is softer than ~100–120 ([[07 Risks & Debt/Risks & Technical Debt|R-012]]); keep observing.
- GitHub push on user's word (commits 08f71c3..5441ead are local-only).

## Blocked
- (none)

## Next Actions
1. User: reload the unpacked extension, re-run a search to the end; watch `phase2-visit` DIAGs for `closeMethod`.
2. Confirm the CSV Phone/Website fill rate across all visits.
3. Push to GitHub when the user says.

## Last Verified
2026-08-30 (Node test suites — 8 phase-2 scenarios + 5 suites; live re-run pending)

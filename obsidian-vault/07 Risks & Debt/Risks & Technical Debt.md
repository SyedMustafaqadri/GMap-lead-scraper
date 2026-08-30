---
type: risks-debt
created: 2026-08-26
status: active
---

# Risks & Technical Debt

> Track known risks and debt with severity/status. Update as new ones appear or get mitigated.

## R-001 — Google Maps DOM fragility (High)
Maps markup changes without notice; selectors can break. **Mitigation:** build against inspected real DOM, keep extraction logic isolated, prefer stable attributes (data attributes / aria) over brittle paths. See [[05 Pitfalls/Do Not Guess DOM]].

## R-002 — CAPTCHA / intervention (Medium)
Maps may demand CAPTCHA, halting extraction. **Mitigation:** first-class CAPTCHA_DETECTED state, pause + notify + sound, resume on solve (spec §35).

## R-003 — MV3 constraints (Medium)
Service workers are event-based/short-lived; long-running extraction must live in Content Script + persisted state, not the worker. **Mitigation:** keep orchestration stateless-ish, persist checkpoints to IndexedDB (spec §22).

## R-004 — Enrichment hangs / abuse (Medium)
Website fetches may hang or be slow. **Mitigation:** bounded worker pool + per-site timeout + size caps (spec §32–§33).

## R-005 — Data loss on crash (Low/Medium)
Mitigated by checkpointing every 20 leads / 10s (spec §22). Verify recovery path once persistence is built.

## R-006 — ToS / policy risk (Medium)
Automated extraction may conflict with Google Maps terms. **Note:** flagged for the user to review; not a code blocker.

## R-007 — Overlay injection/z-index conflicts on Maps (Low/Medium)
The overlay is injected into a third-party page whose CSS and stacking contexts change without notice; Maps redesigns could clash with the fixed top-right position or paint over it. **Mitigation:** Shadow DOM isolation + max z-index (2147483647); if Maps ever paints above, consider a move/drag affordance. Status: open, verify on live run.

## R-008 — Orphaned job after mid-run hard navigation (Low)
A hard navigation destroys the overlay/content script; `pagehide` posts `STOP`, but if that send fails the job idles until the SW watchdog (300 s) stops it. A reopened overlay rehydrates state, so impact is bounded. **Mitigation:** watchdog + rehydration; future: SW-side tab-liveness check. Status: open.

## R-009 — Phase-2 click volume may trigger rate limiting (Medium)
Detail-panel visiting clicks one place per ~2–4 s (raised from 1–2 s after the 2026-08-30 live run) after the feed run. **Mitigation:** random inter-visit delay, CAPTCHA detection + pause before every visit, DIAG progress per visit (`phase2-visit`). Status: partially mitigated — re-check fill rates on the next live run.

## R-010 — Virtualized card anchors missing at phase 2 (Low)
Maps may virtualize feed cards away after long scrolls, so a lead's anchor may not be in the DOM when phase 2 runs. **Mitigation:** `findCardAnchor` retries once after scrolling the feed back to top; if still missing the lead is skipped with a `phase2-card-not-found` DIAG. Status: open.

## R-011 — Phase 2 can destroy the search session (High → mitigated 2026-08-30)
Observed live: clicking into a **stalled** feed (Google's loader hung on its spinner) and closing the panel dropped the search context entirely — URL fell back to `/maps/@lat,lng`, empty feed, all remaining visits failed. **Mitigation (round 2):** phase 1 no longer ends while the spinner is up (spinner patience + 60 s settle window); `tryPhase2` health gate (never click a busy/dead feed); `waitFeedBack` requires the feed back **healthy** after each close and aborts cleanly with `phase2-feed-not-restored` if the session is lost. Status: mitigated — confirm on live re-run.

## R-012 — Single-search result cap (~100–120 leads) (Medium, product constraint)
Google Maps serves only ~100–120 results per search regardless of query size; a 500 target cannot be met by one search (observed on the Dallas run: 76 leads, feed stalled near the cap). **Future feature:** multi-search strategy (split by area/zip/zoom, merge + dedupe across searches). Not a bug — expectation setting.

## R-013 — SW suspension eats messages; mid-list stall variant (High → mitigated 2026-08-30)
Observed on the Kansas City run: leads froze at 34 with the feed stalled **mid-list** (no spinner, not at bottom — a variant the spinner/bottom patience didn't cover), and the SW suspended ~30 s after its last message while the visible tab's loop kept running on local timers. Every later message (DIAGs, the user's STOP) was silently swallowed (`GMLE.post` caught all errors), so Stop had no job to stop and never completed (no xlsx). **Mitigation (commit `edb566d`):** 20 s PING/PONG keepalive keeps the SW alive for the whole run; send failures are logged, not swallowed; STOP is forwarded even for unknown jobs; DONE for unknown jobs flushes a storage-fallback export; stale-abandon resets the restore cache; stalled growth glides straight to the bottom trigger. Status: mitigated — confirm on live re-run (expect: no silent freezes; Stop always ends the run with an xlsx).

## Resolved 2026-08-30 — detail-page `fetch()` silently intercepted
The content-script `fetch()` detail-page path (added 2026-08-29 for phones) returned zero data with zero errors on the restaurant run (page SW/CSP interception). Removed entirely, replaced by two-phase UI visiting ([[03 Decisions/Decision Log|D-007]]). R-004 (enrichment hangs) unaffected — that covers SW-side website fetches.

## D-005 debt — export only offers the current/most-recent job
The overlay exposes export for the rehydrated current job only; there is no job list/history UI (IndexedDB `jobs` store has the data). Deferred until a real need exists.

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

## D-005 debt — export only offers the current/most-recent job
The overlay exposes export for the rehydrated current job only; there is no job list/history UI (IndexedDB `jobs` store has the data). Deferred until a real need exists.

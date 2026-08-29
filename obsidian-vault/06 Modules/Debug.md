---
type: module
created: 2026-08-29
status: implemented
---

# Debug (dev drawer + trace core)

Developer-only debug tooling, hidden from regular users. Access: set `GMLE.DEV_MODE = true` in `modules/config.js` (next to `GMLE.DEMO_MODE`), reload the extension. No UI toggle exists by design ([[03 Decisions/Decision Log|D-006]]).

## Files
- `modules/debug.js` — shared core: event ring buffer (300) + log ring buffer (300, sized via `GMLE.config.debug`). API: `GMLE.debug.log(level, tag, msg)` (`info|warn|error|debug`; warn/error mirror to console), `installTap()` (hooks the `GMLE._traceTap` in `modules/messaging.js`, skips `DEBUG_*` types to prevent feedback), `setListener(fn)` (`fn('event'|'log', entry)`), `getEvents/getLogs(sinceTs)`, `clearAll()`, `formatTs()`. Event entries: `{ts, ctx, dir: 'send'|'send:tab'|'recv', type, summary, payload}` — payloads are slimmed (arrays → 3 items, strings → 300 chars, depth 2).
- `background.js` — the SW is the **trace hub** (all traffic passes through it): installs the tap, buffers via `setListener`, and streams to the overlay tab as `DEBUG_EVENTS` batches (~250 ms coalesced) while streaming is on; sends the full backlog when the drawer opens. Disables the stream if the tab is gone (post rejected).
- `overlay/overlayDebug.js` — `GMLE.debugUi`, mounted by the overlay only when `GMLE.DEV_MODE`; guards against re-injection replacing a mounted instance.

## Debug drawer UI
Header bug icon toggles the drawer inside the panel. Three tabs + Demo run button:
- **State:** live SW snapshot (`DEBUG_GET_STATE` → `DEBUG_STATE`): current/stored jobId, job fields (status, target, totals, duplicates, enrichment, lastLead), per-tab Maps status, stream flag. Buttons: Refresh, Dump to console.
- **Events:** real-time message trace (newest first), direction arrow (`→ out` / `→ tab` / `← in`), type filter, Pause, Clear (also clears SW buffers), click row to expand the slimmed payload JSON.
- **Log:** leveled log lines from `GMLE.debug.log` in the SW (start/stop/export/checkpoint/CAPTCHA/DIAG entries), level dropdown + text filter, Copy all (clipboard with textarea fallback), Clear.
- **Demo run:** posts `START_EXTRACTION {demo:true}` using the panel's current target + selected fields.

## Message types (modules/messaging.js)
`OVERLAY_TOGGLE`, `REQUEST_STATUS`, `DEBUG_GET_STATE {stream:bool}`, `DEBUG_STATE`, `DEBUG_EVENTS {events[], logs[]}`, `DEBUG_CLEAR`. All DEBUG_* traffic is tab-targeted and excluded from tracing.

## Verification checklist
- [ ] `GMLE.DEV_MODE=true` → bug icon in overlay header; drawer opens.
- [ ] State tab matches real counters during a demo run; Refresh works.
- [ ] Events tab shows `← in START_EXTRACTION`, `→ tab START`, `← in LEADS_DISCOVERED`, `→ tab STATUS_UPDATE` flow; filter + payload expand work.
- [ ] Log tab shows diag/start/export lines; Copy all works.
- [ ] With `DEV_MODE=false`: no bug icon, no drawer, no debug messages (zero user-facing surface).

## Related
- [[06 Modules/Overlay UI]], [[02 Architecture/Components]], [[03 Decisions/Decision Log|D-006]]

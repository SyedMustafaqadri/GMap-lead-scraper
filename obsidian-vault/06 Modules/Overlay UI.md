---
type: module
created: 2026-08-29
status: implemented
---

# Overlay UI (V2)

Floating overlay panel injected into Google Maps pages. Replaces the deleted `sidepanel/` per [[03 Decisions/Decision Log|D-005]].

## Files
- `overlay/overlay.js` — controller. **Dormant** content script: registers the `OVERLAY_TOGGLE` listener at page load, creates zero DOM until first toggle (`GMLE.__overlayLoaded` guard). Builds a `<div id="gmle-overlay-host">` on `document.documentElement` with an open Shadow DOM, injects `overlay/overlay.css` via `<link>` (needs `web_accessible_resources`) + static template markup.
- `overlay/overlay.css` — all styles, CSS-variable tokens (`--gm-*`, Google palette), scoped to `.gm-trigger`/`.gm-panel`; `[hidden]{display:none!important}` inside the root; max `z-index: 2147483647`.
- `overlay/overlayDebug.js` — dev drawer (`GMLE.debugUi`), mounted only when `GMLE.DEV_MODE` is true; see [[06 Modules/Debug]].

## Behavior
- **Trigger ⇄ panel:** toolbar click → SW `OVERLAY_TOGGLE` → panel opens (first time builds DOM). Collapse button minimizes to a 42px round blue FAB top-right (16px offset). Panel: fixed top-right, 340px, `max-height: calc(100vh - 32px)`.
- **Layout:** header (logo, state pill, bug icon if DEV_MODE, collapse) · status card (Maps ready + "Search detected: …") · one full-width Start/Stop button · metrics card (`347 / 500 leads`, Duplicates, Enriched, current business — never %, spec §39) · Export XLSX · collapsed "Extraction settings" (target + 9 field checkboxes).
- **Settings persistence:** `chrome.storage.local` `settings` key via `GMLE.storage.getSettings/saveSettings` — `{targetLeads, fields{key:bool}, settingsOpen, debugOpen}`.
- **Rehydration:** every panel open posts `REQUEST_STATUS`; SW answers with `STATE_CHANGED` + `STATUS_UPDATE` + `MAPS_STATUS` for the sender tab.
- **Lifecycle:** tab close / hard nav while running → `pagehide` posts `STOP` (spec §40 remapped; collapsing does NOT stop). SPA soft navs keep the script alive.
- **Data safety:** all dynamic values rendered via `textContent`; markup is static.

## Transport (critical)
`chrome.runtime.sendMessage` broadcasts do NOT reach content scripts. All SW→overlay pushes are tab-targeted `GMLE.postToTab`: `STATE_CHANGED`, `STATUS_UPDATE`, `MAPS_STATUS` relay, `DEBUG_*`. Overlay→SW uses `GMLE.post` (runtime). `START_EXTRACTION` carries no tabId — the SW takes `sender.tab.id`.

## Verification checklist
- [ ] Load unpacked: no manifest errors, side panel gone, version 0.2.0.
- [ ] Toolbar click on a Maps tab toggles overlay; non-Maps tab shows "Maps" badge.
- [ ] Fallback: Maps tab opened *before* install/reload — toolbar click still opens overlay.
- [ ] Trigger ⇄ panel toggle; Maps interaction unblocked; no style bleed either way.
- [ ] Start gated on Maps-ready; search line shows detected query.
- [ ] Demo run → metrics update → COMPLETED pill → XLSX downloads (SW-side).
- [ ] Reopen mid-run shows live progress; tab close stops the job.
- [ ] `GMLE.DEV_MODE=true`: bug icon visible, drawer works (see [[06 Modules/Debug]]).

## Related
- [[06 Modules/Debug]], [[02 Architecture/Components]], [[03 Decisions/Decision Log|D-005]], [[06 Modules/Content Script]] (to be created)

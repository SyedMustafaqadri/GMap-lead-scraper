---
type: session-log
---

# Session Log

## 2026-08-29 — Fix: stale job resurrected on fresh browser (overlay "resumes" old run; Stop stuck)
- **Root cause (user report):** closing the browser mid-run left `chrome.storage.currentJobId` set (it was only cleared on clean COMPLETED). After a full browser restart, opening the overlay fired `REQUEST_STATUS` → `ensureJobRestored()` rebuilt **yesterday's dead job as RUNNING** → overlay showed the old progress with a live Stop button. Stop then marked it STOPPING and sent STOP to the tab, but the fresh content script's `jobId` was null → its `DONE` matched nothing → job stuck in STOPPING forever.
- **Fix — liveness-checked restore:** `ensureJobRestored(notifyTabId)` now sends `CHECK_JOB {jobId}` to the stored job's tab and waits ~1.2 s for `JOB_ACK`. The content script acks **only** when `running && payload.jobId === jobId` (a genuinely live loop — the legit mid-run SW-restart case). No ack → **stale**: job removed from memory, storage pointer cleared, `STATE_CHANGED IDLE` posted to the requesting overlay (which resets to Idle; the old checkpointed leads remain exportable via the `REQUEST_EXPORT` storage fallback). New message types `CHECK_JOB`/`JOB_ACK`; STOP and REQUEST_STATUS pass the requesting tab id for the IDLE broadcast.
- **Verified (SW harness):** stale scenario — CHECK_JOB sent, overlay reset to IDLE, pointer cleared, no fake STATUS_UPDATE; live scenario — ack → restored (STATUS_UPDATE total=2, pointer kept). Content harness — ack only when running + matching jobId. Full `node --check` sweep passes.
**Completed:** Stale-job abandon + live-restore liveness check.
**Pending:** User live verification (restart browser → open overlay → expect Idle, not old progress).
**Blocker:** None.
**Next:** Push to GitHub once the user confirms.
**Note:** NOT pushed to GitHub — user asked to hold until they say.

## 2026-08-29 — Background extraction (hidden-tab heartbeat) + dev copy buttons + speed tuning
- **Hidden-tab extraction (user request, "option 3"):** Chrome throttles hidden-tab timers to ~1/min, stalling the loop when the user switches windows. New `gmSleep(ms)` in `content/content.js`: when `document.hidden` is false → plain `setTimeout`; when hidden → **SW round-trip** (`SCHEDULE_TICK {delayMs, tickId}` → SW `setTimeout` → `LOOP_TICK {tickId}` → waiter released). Messages into hidden tabs are delivered instantly (never throttled) and the round trips keep the SW alive; `runtime.sendMessage` also wakes a suspended SW. All loop timers converted (feed-change polls, cycle delay, captcha poll, feed-lost wait, cooldown, detail-queue drain, finish gate). `scrollFeedStep` uses instant scroll while hidden (smooth scroll depends on rAF, frozen when hidden). `SCHEDULE_TICK`/`LOOP_TICK` excluded from the debug trace tap. Verified: hidden harness with simulated timer throttling → 70 SW round-trips, 21 lead batches, no local timers used; visible path regression → 0 SCHEDULE_TICKs.
- **Dev drawer copy buttons (user request):** State tab got **Copy** (full snapshot JSON), Events tab got **Copy** (visible/filter-respecting trace lines incl. payload JSON, newest first) with clipboard-API + textarea fallback and "Copied ✓" flash. Log tab already had one.
- **Speed tuning (user request):** `GMLE.config.scroll` — cycle delay 1000–2500 ms (was 1500–3500), change-wait budget 4–6 s (was 5–8), poll 250 ms (was 300), reading pauses 2–4 s every 10–16 cycles (was 3–6 s every 8–14), stall cooldown 15 s (was 20); detail-fetch jitter 250–600 ms (was 400–1000). Expected pace ≈ 1.5–3 s/page. README perf table updated.
- Harness note: a test bug (outer harness timeouts passing through the simulated-throttling wrapper → process exit after 5 ms) initially masked a real crash: LOOP_TICK branch used `p.tickId` but the content dispatcher's variable is `payload` — fixed.
**Completed:** Background extraction at full speed when hidden; copy buttons; faster pacing; all syntax checks pass.
**Pending:** User live run — extract in a background window and confirm full speed.
**Blocker:** None.
**Next:** Live verification.

## 2026-08-29 — Fix: phones empty on new card layout + Stop button dead + interaction kills extraction
- **Phone (user CSV + logs):** pipeline was healthy (DIAG/LEADS batches flowing); the new Maps card layout simply **does not render phone numbers in feed cards** (zero in 108 CSV rows, `tel:` hook absent). Fix: content script now fetches each place's **detail page** (same-origin `fetch`, no UI clicking) from a background queue that drains **in parallel with scrolling** (~1 fetch/s, jitter 400–1000 ms), parses phone via `href="tel:"` (fallback: tag-stripped text scan) and the website via first non-Google link; posts new `LEADS_ENRICHED {jobId, fp, updates}`; SW merges by fingerprint into stored leads and re-queues email enrichment when a website appears. DONE is now gated on queue drain (`finishJobLocal`) so last-batch phones make the export; STOP drops the queue. Blocks itself if Google serves an "unusual traffic" page.
- **Category/address pollution (CSV):** `_looksLikeAddress` matched `st` as a substring — "Re**st**aurant" classified as address (seen in CSV row Eatlay). Added word boundaries. Also excluded rating lines with comma counts (`4.3(1,095)`, `(1,095)`, two-line form), price lines (`Rs 1–6,000`), attribute chips (Family-friendly/Dine-in/etc.), and quoted review snippets. Verified 6/6 on row shapes taken from the user's CSV.
- **Stop button dead:** `stopJob` no-ops when the MV3 service worker restarted (jobs were memory-only). Fix: `ensureJobRestored()` rebuilds the active job from IndexedDB (`chrome.storage.currentJobId` → `getJob`/`getLeads` → `jobManager.create({jobId})` + rebuilt `seen` set) before STOP / LEADS_DISCOVERED / LEADS_ENRICHED / DONE / REQUEST_EXPORT / REQUEST_STATUS. SW keeps no memory-only state that matters now. (`jobManager.create` accepts `opts.jobId`.)
- **Interaction stops extraction:** clicking a place / changing filters removes the feed; the loop counted dead cycles → premature `DONE no-results`. Fix: when `[role="feed"]` is missing, the loop posts a `feed-lost-waiting` DIAG and polls every 2 s for its return — no dead-cycle accumulation, no DONE; bounded by the SW 300 s idle watchdog. Scrolling is skipped while the feed is absent.
- **All verified in Node harnesses:** classification 6/6 CSV row shapes; `phoneFromHtml`/`websiteFromHtml`; content loop — STOP mid-run (0 batches after, `DONE 'stop'`), detail enrichment (11 updates with phone+website), feed-lost (1 DIAG, no premature DONE, resumed); SW restart — STOP forwarded + STOPPING broadcast, leads accepted (total=2), phone/website merged + persisted. Full `node --check` sweep passes.
**Completed:** All three reported issues fixed + detail-page enrichment feature.
**Pending:** User live run — verify Phone/Website columns fill, Stop works mid-run, extraction survives opening a place page.
**Blocker:** None.
**Next:** Live verification; README note: detail-panel scraping idea is now implemented (via same-origin fetch).

## 2026-08-29 — Fix v2: scroll never reached the pagination trigger (only ~8 leads)
- **Root cause of the regression:** v1's `scrollFeedStep()` capped the scroll target at `maxTop - view×(0.15–0.35)` — it could **never reach Maps' pagination trigger at the bottom**. Result: no page ever loaded, every cycle burned its full 8–12 s wait budget on nothing, and the run crawled to `DONE no-results` with just the initially-loaded ~8 leads (user-confirmed: "halfway scrolling, not full down").
- **Fix:** (1) `scrollFeedStep()` now approaches the bottom in smooth 0.8–1.5×-viewport steps and, when within ~1.5 viewports, glides fully to the bottom — reaching the bottom *is* the pagination trigger; the margin cap is gone. (2) `waitForFeedChange` treats grow-**or-shrink** as "page landed" (Maps can virtualize early cards away). (3) Speed tuning in `modules/config.js`: base delay 1.5–3.5 s (was 2.5–5.5), change-wait budget 5–8 s with 300 ms polling (was 8–12 s/500 ms), reading pauses 3–6 s every 8–14 cycles, cooldown 20 s. Effective pace ≈ 2.5–5 s/page — ~2× faster than the manual baseline but still variable and single-flight.
- **Verified with bottom-triggered mock** (feed grows only when scrolled to the very bottom — the old logic extracts nothing new here): 595 leads extracted continuously, no premature `no-results`, clean `DONE 'end'` on end-of-results. `node --check` passes; `bottomMargin*` config keys removed.
**Completed:** Scroll trigger + pacing fixed and mock-verified.
**Pending:** User live run to confirm real-Maps behavior and throughput.
**Blocker:** None.
**Next:** Live verification; further tuning only from a real-session HAR if needed.

## 2026-08-29 — Fix: feed stall at ~50-60 leads (humanized adaptive scroll loop)
- **Root cause (HAR RCA, `www.google.com.txt`):** manual healthy flow paginates every ~6–10 s, strictly single-flight, partial scrolls, zero errors; the extension hard-jumped `scrollTop = scrollHeight` every fixed 1.2 s, firing pagination triggers while the previous `/search` page was in flight → Maps' single-flight feed loader dropped them → spinner wedged after ~4–6 pages (≈50–60 leads). All aborted requests in the HAR were benign (autocomplete, superseded tile streams).
- **Fix in `content/content.js`:** (1) `scrollFeedStep()` — partial smooth `scrollTo` landing 15–35% of viewport above the bottom, never pins to absolute bottom, never scrolls up; (2) `waitForFeedChange()` — single-flight wait polling feed `scrollHeight`/anchor count (pure measurement, D-004-safe) until the next page lands or an 8–12 s budget expires; (3) randomized cadence 2.5–5.5 s + irregular "reading pauses" (4–9 s every 5–9 cycles, rolling counter — no metronomic pattern); (4) one 25 s stall cooldown after 3 dead cycles, `DONE no-results` after 8; (5) `diag()` now carries `feedH/feedTop/streak/lastWaitMs/cooldownUsed` for the debug drawer.
- **Fix in `modules/config.js`:** replaced `scroll` block with the humanized pacing params (documented inline with the HAR rationale); `afterScrollMs`/old `maxConsecutiveNoNew` removed (no other references).
- **Verified with mocked-DOM Node harness (shrunk timers):** happy path — 6 `LEADS_DISCOVERED` batches, 30 leads, feed growth resets streak, `DONE 'end'` at end-of-results; stall path — streak reaches 8, single cooldown DIAG fires once, `DONE 'no-results'`. `node --check` passes; `afterScrollMs` fully removed.
**Completed:** Loop rework implemented + logic verified in mock; trade-off accepted: ~500 leads now takes ~3–4 min (25–30 pages × ~6–9 s) — that is the fix, not a regression.
**Pending:** User live run to 100+ leads to confirm no wedge; observe cadence in debug Events tab; confirm XLSX export.
**Blocker:** None.
**Next:** Live verification; then back to `extractors.js` live-DOM tuning.

## 2026-08-29 — Git init + pushed to GitHub
- Initialized git repo (branch `main`), added `.gitignore` (build artifacts, logs, OS junk, `.env`, `.zcode/` local plans), created the initial commit (V2 overlay UI state), created the private GitHub repo `SyedMustafaqadri/GMap-lead-scraper` via API using the stored Git Credential Manager token, and pushed `main` (upstream set).
**Completed:** Remote https://github.com/SyedMustafaqadri/GMap-lead-scraper — repo is **private**; flip to public in Settings if desired.
**Next:** Continue V2 verification / extraction tuning; commit future work normally.

## 2026-08-29 — Fix: no phone numbers extracted (PK-only regex)
- **Root cause:** `_phoneFromText` in `content/extractors.js` only matched Pakistani formats (`+92 …` or leading-`0`), so international formats (`(204) 555-7391`, `+1 416-555-0199`, `+44 20 …`) never matched; even PK `(042) 3575-5012` failed because `)` after the area code wasn't an allowed separator.
- **Fix:** (1) prefer a `tel:` link inside the card when present (`a[href^="tel:"]` — the D-004 stable hook, previously unused by the extractor). (2) New international regex: optional country code / area-code parens / leading-0 trunk prefix, greedy digit run with up to 3 separator splits, validated by total digit count (7–15) to reject ratings/hours/address numbers. (3) Matching runs **per card line** (lines joined with `\n`) — the phone sits on its own line, preventing gluing to street numbers; a `+`-form match always wins over a fallback.
- Verified with a Node test over 11 card shapes: US paren, +1, +92 mobile, PK landline (3 spellings incl. parens), +44, UAN multi-group, status-line phone, and negatives (reviews line, address-only) — all correct. `node --check` passes.
**Completed:** Phone extraction is format-agnostic; user to reload extension + re-run to confirm live.
**Pending:** If some cards still show no phone, Maps may simply not render the number in the list card for that region — per-place detail-panel scraping would be needed (future work).
**Blocker:** None.
**Next:** Re-run live extraction and verify Phone column in the XLSX.

## 2026-08-29 — Fix: export button did nothing (importScripts after SW init)
- **Root cause:** `background.js` lazy-loaded SheetJS via `importScripts('lib/xlsx.full.min.js', …)` inside the export handler. Chrome MV3 forbids `importScripts()` after the service worker's initial evaluation ("Cannot use importScripts after init" — Chromium issue 40737342), so `GMLE.buildXlsx` threw on every export → both the button and the auto-export on COMPLETED failed **silently** (errors only went to the debug log, and the overlay had no `ERROR` handler).
- **Fixes:** (1) moved `lib/xlsx.full.min.js` + `modules/xlsxExport.js` into the top-level `importScripts` (accepted cost: ~882 KB parse per SW wake); removed `ensureXlsx`/lazy logic. (2) Export failures now post `ERROR` back to the overlay tab, which shows a red error line in the status card (cleared on next `STATE_CHANGED`/`MAPS_STATUS`) — exports can never fail silently again. (3) `REQUEST_EXPORT` passes `sender.tab.id` so errors reach the requesting overlay even when the job is no longer in memory.
**Completed:** Export path reworked + error surfacing; `node --check` passes.
**Pending:** User to reload the extension and confirm the XLSX downloads on Export click and auto-export.
**Blocker:** None.
**Next:** Continue the V2 verification checklist in [[06 Modules/Overlay UI]].

## 2026-08-29 — V2 UI overhaul: floating overlay panel + dev debug section
- Replaced the Chrome side panel with a **floating overlay UI** injected into Google Maps pages: `overlay/overlay.js` (dormant content script; creates zero DOM until first `OVERLAY_TOGGLE`), `overlay/overlay.css` (Shadow-DOM isolated styles, `web_accessible_resources`), `overlay/overlayDebug.js` (dev drawer). Panel is fixed top-right (340px, `z-index: 2147483647`), collapsible into a 42px round trigger button. Side panel removed entirely (`sidepanel/` deleted, `side_panel` key + `sidePanel` permission dropped from manifest).
- **Toolbar flow:** `chrome.action.onClicked` → `OVERLAY_TOGGLE` to active Maps tab; if the tab predates install/reload (no listener), falls back to `chrome.scripting.executeScript` with the full manifest script list, then retries. Non-Maps tab gets a transient "Maps" badge hint.
- **Export moved to the service worker:** `background.js` lazily `importScripts` SheetJS + `modules/xlsxExport.js` on export; `REQUEST_EXPORT` and auto-export on COMPLETED build a base64 data URL and call `chrome.downloads.download` directly. `EXPORT_DATA` message type removed; the 882 KB SheetJS lib no longer loads in the UI context. Overlay sends `START_EXTRACTION` without tabId — SW uses `sender.tab.id`.
- **Simplified layout (Google-ish palette kept):** header (logo + state pill + collapse), status card (Maps-ready + "Search detected: …"), one full-width Start/Stop button, compact metrics card (Leads x/target, Duplicates, Enriched, current business — no %, spec §39), Export button, collapsed "Extraction settings" section (target + 9 field checkboxes). Settings now persist via `GMLE.storage.getSettings/saveSettings` (previously unused). Scrolling log box and Demo button removed from the main UI.
- **Dev debug section** gated by `GMLE.DEV_MODE` flag in `modules/config.js` (no UI toggle; flip + reload extension). Header bug icon opens a drawer with three tabs: **State** (live SW snapshot via `DEBUG_GET_STATE`/`DEBUG_STATE`), **Events** (real-time message trace with filter/pause/payload expand), **Log** (leveled logs via `GMLE.debug.log`, filter/copy/clear). Demo run moved into the drawer.
- **New debug core** `modules/debug.js` (event + log ring buffers, 300 each via `GMLE.config.debug`); `modules/messaging.js` gained a trace tap (`GMLE._traceTap`) recording every send/recv in the SW (hub), with DEBUG_* traffic excluded to prevent feedback loops. New message types: `OVERLAY_TOGGLE`, `REQUEST_STATUS`, `DEBUG_GET_STATE`, `DEBUG_STATE`, `DEBUG_EVENTS`, `DEBUG_CLEAR`.
- **Key transport fix:** runtime.sendMessage broadcasts do NOT reach content scripts (verified against Chrome docs) — all UI-facing pushes now go tab-targeted via `GMLE.postToTab` (`STATE_CHANGED`, `STATUS_UPDATE`, `MAPS_STATUS` relay back to sender tab, DEBUG_*). On overlay open it sends `REQUEST_STATUS` and the SW rehydrates current job state (state rehydration gap fixed). Backlog from the ring buffers is flushed to the debug drawer when it opens.
- Tab close / hard navigation while running posts `STOP` via overlay `pagehide` (spec §40 remapped: collapsing the panel does NOT stop extraction). `content.js` got a `__contentLoaded` re-injection guard; `overlayDebug.js` guards against replacing a mounted instance.
- Verified: `node --check` passes on all 16 JS files; manifest JSON valid. Consistency review caught and fixed missing `storage.js`/`stateMachine.js` in the content-script list.
**Completed:** Full V2 UI implementation (overlay + trigger + debug drawer + SW export + rehydration); side panel removed; manifest 0.2.0.
**Pending:** Live browser verification (load unpacked, toolbar toggle on Maps, demo-mode end-to-end, real-Maps run, DEV_MODE drawer inspection) — user-assisted per DoD.
**Blocker:** None.
**Next:** Load unpacked in Chrome and run the verification checklist; then resume live-DOM tuning of `extractors.js` (previous pending work).

## 2026-08-26 — Fix: field parsing (name/phone/category/address) in extractors.js
- Root causes from real extracted data: (1) name used `a[aria-label]` → whole-card text; (2) phone relied on `a[href^="tel:"]` but Maps shows the number as plain text; (3) category/address were merged/swapped and the status+phone line (`Closed · Opens 12 PM · 0303…`) was captured as address.
- Rewrite `content/extractors.js`: name = first text line of card; phone extracted via regex on card text (PK format `\+92\s?\d{2,4}([\s.-]\d{2,8}){1,4}` and `0\d{2,4}(...)`), stripping spaces/parens; category/address split on `·` (first part=category, last part=address), PUA glyphs (`\uE000-\uF8FF`) and star chars stripped from card text; status lines (open/closed) excluded and their phone lifted.
- Verified with a mock-DOM Node test over all 9 sample cards: phones now exact (`+922133220642`, `+923120233316`, etc.), categories/addresses correctly separated. Row with only a glyph category → null (acceptable). Long names (rows 8/9) still contain the ` | ` area/tagline suffix — cosmetic, not fixed.
**Completed:** Field parsing produces clean phone/category/address; rating/reviews already correct.
**Pending:** User to reload + re-run and confirm columns populate; decide whether to trim ` | `-suffixed names.
**Blocker:** None.
**Next:** If names need trimming, strip at ` | `; otherwise move to scroll/volume (more than 8 results) and enrichment.

## 2026-08-26 — Fix: `GMLE.fingerprint is not a function` (missing content-script module)
- The content script's `js` array in `manifest.json` loaded `config, messaging, selectors, extractors, content` but **not `dedupe.js`**, which defines `GMLE.fingerprint`. `extractAll()` calls `GMLE.fingerprint`, so the loop threw immediately → 0 leads, no file. DIAG kept working because it doesn't use fingerprint.
- Fix: added `modules/dedupe.js` to the content_scripts `js` list. Also wrapped `extractAll()` in try/catch (logs, continues) and added console traces: `[content] START received`, `[content] loop#n anchors=L leads=M seen=K`, `[SW] LEADS_DISCOVERED count=…`, `[SW] startExtraction …`.
**Completed:** Content script now has `GMLE.fingerprint`; loop runs; leads should flow.
**Pending:** User to reload extension + Maps tab, run, confirm `Leads:` increments and `.xlsx` downloads; watch `[content]`/`[SW]` console logs.
**Blocker:** None.
**Next:** If verified, tune `extractors.js` field parsing from a real card's HTML.

## 2026-08-26 — Fix: leads stuck at 0 / no XLSX (IndexedDB gating)
- DIAG proved content→SW→panel messaging works and `a[href*="/maps/place/"]` finds 8 anchors (real selector confirmed: `https://www.google.com/maps/place/Dr+Arif+Hussain...`). So extraction WAS finding links.
- Root cause: in `background.js`, `STATUS_UPDATE` and the export path were both gated behind the IndexedDB `checkpoint()` promise. The first batch tripped the 10s/20-lead checkpoint threshold (user delay between START click and results), so if IndexedDB write failed/rejected, the status was never sent and finalize never exported → permanent 0 + no file.
- Fixes: `handleLeads` now sends `STATUS_UPDATE` immediately (not inside checkpoint); `checkpoint()` errors are caught (non-fatal); `finalizeJob` completes even if checkpoint rejects; `exportToPanel` exports from the **in-memory** `job.leads` (IndexedDB now best-effort, reserved for crash recovery). Added `[SW] LEADS_DISCOVERED` console log.
- Also hardened `scrollFeed()` (set `scrollTop=scrollHeight` on `[role="feed"]` + fallback to root + window) so lazy-loaded results actually appear; prior `scrollBy(clientHeight*0.8)` could no-op if the feed wasn't the measured scroller.
**Completed:** Leads should now count up and an `.xlsx` should download even if IndexedDB is unavailable; scroll should load more results.
**Pending:** User to reload + run; confirm `Leads:` increments and a file downloads; confirm `[SW] LEADS_DISCOVERED count=8` in SW console.
**Blocker:** None.
**Next:** If file downloads, tune `extractors.js` field parsing (name/phone/website/category/address) from real card HTML; verify scroll loads >8.

## 2026-08-26 — Bug fix: panel crash + SW rejection + diagnostics
- Fixed panel crash: `sidepanel.html` was not loading `modules/stateMachine.js`, so `GMLE.States` was undefined and every `STATE_CHANGED` handler threw (`Cannot read properties of undefined (reading 'COMPLETED')`). Added the script tag.
- Fixed unhandled rejection: `GMLE.post`/`GMLE.postToTab` now `.catch()` the returned promises (MV3 `sendMessage` returns a promise; a missing receiver rejected and logged "Receiving end does not exist" in `background.js`). Wrapped `GMLE.onMessage` handler in try/catch too.
- Added live `DIAG` message: content script reports `anchorsPlace`, `totalAnchors`, `feed`, and a sample `href` on START and every 3rd loop; SW forwards to panel; panel logs it. Goal: discover the real Google Maps link/selector shape (the truncated dump couldn't confirm it).
- Added termination safety: if 6 consecutive scroll cycles find **zero** `a[href*="/maps/place/"]` anchors, content sends `DONE` (reason `no-results`) so the job always exports instead of looping forever.
- SW now pushes an initial `STATUS_UPDATE` on START so the panel shows 0 counts immediately.
**Completed:** Both crashes fixed; diagnostics + no-results termination added; all JS passes `node --check`.
**Pending:** User to reload extension + Maps tab, run, and paste DIAG lines to confirm real selector shape.
**Blocker:** None (awaiting user's DIAG output to finalize `extractors.js`).
**Next:** Tune `content/selectors.js`/`extractors.js` from DIAG sample hrefs; confirm end-to-end XLSX.

## 2026-08-26 — Extension MVP scaffold built
- Implemented the full vanilla-JS MV3 extension: `manifest.json`, `background.js` (orchestration/state machine/job mgmt/dedupe/persistence/enrichment queue), `sidepanel/*`, `content/*`, and `modules/*` (config, messaging, stateMachine, dedupe, storage, jobManager, enrichment, xlsxExport). Vendored SheetJS into `lib/xlsx.full.min.js` (no remote code, MV3-safe).
- Extraction uses **stable DOM hooks only** ([[03 Decisions/Decision Log|D-004]]): `[role="feed"]`, `a[href*="/maps/place/"]`, `a[href^="tel:"]`, non-google links, `itemprop`; `itemtype="http://schema.org/Place"` noted. Field parsing marked best-effort pending a fuller live card capture.
- Decision: XLSX is generated in the **side panel** (has `window` + `chrome.downloads`), not the service worker, to avoid UMD/module friction.
- Node sanity tests pass: dedupe fingerprint (Maps-URL match) + XLSX base64 generation + filename sanitization. All 13 JS files pass `node --check`.
- Demo mode (`GMLE.DEMO_MODE`, off by default) injects synthetic leads to verify the whole pipeline without live Maps.
**Completed:** Scaffold + all modules + content/panel/SW; Node unit checks.
**Pending:** Load in Chrome as unpacked; live Maps extraction test; fuller DOM capture (complete card, scroll container, end-of-results, CAPTCHA markers) to tune `extractors.js`.
**Blocker:** None (browser run requires user's Chrome; DOM still partially unverified).
**Next:** User loads unpacked → toggle DEMO_MODE for pipeline test → provide fuller DOM capture to finalize selectors.

## 2026-08-26 — DOM capture analyzed + build kickoff
- User provided a Google Maps HTML dump (`html-DOM.md`, "clinic" search, truncated). Analyzed it and recorded findings in `02 Architecture/Maps DOM Reference.md`.
- **Critical finding:** Maps ships Closure-compiler minified, rotating CSS classes → selectors must use stable hooks only. Added decision **D-004** (never minified classes; use ARIA/`/maps/place/`/`tel:`/itemprop).
- Updated Architecture Map (folder layout = vanilla JS, no build), Project State, Backlog, Home, Do Not Guess DOM pitfall.
- Started extension implementation (build mode): scaffold + modules using stable-hook extraction strategy.
**Completed:** DOM analysis vaulted; D-004; folder layout; scaffold in progress.
**Pending:** Finish scaffold (manifest, modules, side panel, content skeleton); live-verify extraction.
**Blocker:** None.
**Next:** Implement `content/selectors.js`/`extractors.js` on stable hooks + demo-mode pipeline test.

## 2026-08-26 — Vault & AGENTS.md bootstrap (restructure)
- Rewrote `AGENTS.md` (root) to mirror the mandated convention: current-state pointers, file-visibility rules, Obsidian second-brain rules, mandatory Task Completion Logging Protocol, Security.
- Restructured `obsidian-vault/` to a numbered taxonomy (00 Home … 08 Tasks) so the protocol's file references resolve.
- Consolidated the three seed decisions into `03 Decisions/Decision Log.md` (D-001 adaptive scrolling/hybrid observation, D-002 state machine, D-003 hierarchical dedupe).
- Added `07 Risks & Debt/Risks & Technical Debt.md` with seed risks (DOM fragility, CAPTCHA, MV3 constraints, enrichment hangs, data loss, ToS).
- No implementation code yet; project is pre-build, pending real Google Maps DOM inspection.
**Completed:** AGENTS.md + vault scaffold (Home, Project State, Session Log, Architecture Map, Components, Data Model, Decision Log, Engineering Principles, Do Not Guess DOM, Risks & Debt, Backlog).
**Pending:** Real DOM inspection; detailed architecture.
**Blocker:** None.
**Next:** Inspect Google Maps DOM and log findings.

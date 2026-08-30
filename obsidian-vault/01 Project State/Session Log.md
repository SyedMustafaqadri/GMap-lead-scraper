---
type: session-log
---

# Session Log

## 2026-08-30 — Fix: dead Stop button after SW suspension + silent message loss
- **RCA from the Kansas City log (`auto repair shop in Kansas City`, user-confirmed no xlsx downloaded):** leads froze at 34 (anchors stuck at 38, mid-list, `bottom:false spinner:false` — a new stall variant) while the visible tab's loop kept running on **local timers**. The SW suspended ~30 s after its last message; every subsequent message (DIAGs, the user's STOP) was **silently swallowed** (`GMLE.post` caught all send errors), so the trace went quiet after 18:38:00, the State snapshot showed `job:null / storedCurrentJobId:null`, and `stopJob()` no-op'd on the unknown job — Stop was dead. Also logged as [[07 Risks & Debt/Risks & Technical Debt|R-013]]: mid-list stall variant.
- **Fixes (commit `edb566d`, local only):**
  1. **SW keepalive (root-cause):** content PINGs the running SW every 20 s (`PING`/`PONG` round trip, excluded from the debug trace). The round trip resets the SW 30 s idle timer in visible *and* hidden tabs, so the worker can no longer suspend mid-run. If no PONG for 60 s → loud console warning + `ERROR` relayed to the overlay ("Background connection lost…").
  2. **Unconditional STOP:** if the job is unknown to the SW, STOP is still forwarded to the requesting tab (warn log) instead of silently doing nothing.
  3. **DONE for an unknown job flushes:** pointer cleared, overlay released (`STATE_CHANGED COMPLETED`), and `exportJob` runs from the IndexedDB storage fallback — the user always gets the file even if the job was lost.
  4. **`GMLE.post` logs send failures** (`[gmle] post <TYPE> failed: …`) instead of swallowing them.
  5. **Restore hardening:** stale-abandon now resets `restorePromise` (previously an abandoned/resolved restore was cached forever and blocked later restores); `CHECK_JOB` ack window widened 1.2 s → 2.5 s.
  6. **Mid-list stall patience:** on stalled growth the scroll glides straight to the bottom pagination trigger (`scrollFeedStep(force)`), so the long bottom-wait budgets and the settle window apply to the Kansas variant too.
- **Tests:** new `tests/test-sw-stop.js` — unknown-job STOP forwarded to the tab; unknown-job DONE → COMPLETED broadcast + storage-fallback export + pointer cleared; stale abandon clears pointer; after abandon a *new* stored job is still restorable (old code cached the resolved restore forever); ack path restores + STATUS_UPDATE. Phase-2 scenario 1 now asserts the PING keepalive runs while the job runs and stops with it. All 6 suites pass; `node --check` clean.
**Completed:** Stop-button root cause fixed (keepalive) + belt-and-braces STOP/DONE paths + mid-list stall patience.
**Pending:** User live re-test: run should no longer freeze silently; if something does fail, Stop must always end the run and produce an xlsx; check for the new `[gmle] post … failed` console warnings.
**Blocker:** None.
**Next:** Live verification; push on user's word.

## 2026-08-30 — Fix: premature end on slow feed + phase 2 destroyed the search session
- **RCA from the user's live Dallas log (`auto repair shop in Dallas`):** phase 1 ran at ~1.8 s/lead, pages landed steadily to 80 anchors / 76 leads, then Google's feed loader **hung on its spinner** (anchors frozen, `feedTop` near bottom for ~80 s). The loop counted 8 dead cycles and declared `no-anchors-found` **while the feed was still loading**. Phase 2 then clicked Motor City (that visit worked), but closing the panel **dropped the search context entirely** — URL fell back to `/maps/@32.76…,-96.91…,12z`, feed present but empty (`anchorsPlace:0, feedH:0`). The old "wait for `[role=feed]` to exist" check passed on the empty re-rendering feed, so the remaining 32 visits each failed `phase2-card-not-found` at ~1.5 s apiece until the user hit Stop. Export itself was fine (76 clean leads). Note: a single Maps search tops out around ~100–120 results — the 500 target needs multiple narrower searches (future feature, not a bug).
- **Fixes (commit `0b2bce0`, local only):**
  1. **Slower pacing** (`modules/config.js` scroll block v3): cycle delay 2.5–5 s (was 1–2.5), scroll step 0.6–0.9 viewport (was 0.8–1.5), reading pauses 4–8 s every 6–10 cycles (was 2–4 every 10–16), stall cooldown 30 s (was 15).
  2. **Spinner patience:** new `feedSpinner()` (stable hooks only: `[role="progressbar"]`/`[aria-busy="true"]` inside the feed, or "Loading" text in the feed's tail) + `atBottom()`. While loading or at the bottom the wait budget is 10–20 s (was 4–6), dead cycles are NOT counted until the spinner has hung continuously for 90 s (`loadingGiveUpMs`), scrolling is skipped while loading, and a one-shot `feed-loading-wait` DIAG marks each loading period.
  3. **Settle window before giving up:** the `no-results` path now calls `waitFeedSettle(60 s)` — resolves `'end'` (end-of-list marker + no spinner → phase 2), `'recovered'` (anchors grew → reset streak, DIAG `feed-recovered-resume`, resume scrolling), or `'giveup'` (DIAG `phase2-skipped-feed-unhealthy`, DONE `no-results`, phase 2 skipped).
  4. **Phase-2 health gate:** `tryPhase2` refuses to click unless the feed is healthy (no spinner, anchors > 0); a busy feed gets one 15 s `feedReadyTimeoutMs` settle chance, then a clean skip.
  5. **Healthy feed-return:** `waitForFeed` replaced by `waitFeedBack` (feed present + anchors + no spinner, 20 s budget). If the feed never restores after a close, the remaining visits are aborted with a `phase2-feed-not-restored` DIAG and DONE still fires (export proceeds) — no more one-by-one failures.
  6. Visit delay raised to 2–4 s; `diag()` now carries `spinner`/`bottom` flags for the debug drawer.
- **Tests:** scenarios 4–7 added to `tests/test-phase2.js` (busy feed → settle then visit; dead feed → graceful give-up with no visits; late page lands → resume scrolling and extract more; search-context lost mid-drain → abort cleanly with one DIAG). Scenarios 1–3 updated for the new flow; all 7 pass, plus extractors/panel/sw-merge suites. `node --check` clean on all JS.
**Completed:** Both live-run failures fixed and mocked-DOM verified.
**Pending:** User live re-test (Dallas or similar): expect slower pace, no early DONE while the spinner is up, and phase 2 draining most visits; check CSV Phone/Website fill rates.
**Blocker:** None.
**Next:** Live verification; push on user's word.

## 2026-08-30 — Implemented: two-phase detail scraping + per-part card classification
- Implemented the plan from [[08 Tasks/Next Session Prompt — Two-Phase Detail Scraping]]. Commit `cd2ad1c` (local only — **not pushed**, per user instruction).
- **Per-part card classification** (`content/extractors.js`): each info line is split on `·` and every part classified; excluded parts are rating-shaped (`4.7(4,699)` / `(4,699)` / `4.7`), price (currency-prefixed), attribute chips, quoted review snippets, status words (Open/Closed/Opens/Closes), pure numbers, and action-button labels (Directions/Website/Save/Share). Restaurant layout now yields Category=`Restaurant` + the real address; clinic status-line phone lifting kept (both `0331…` pure-number and `+92…` forms). Rating/reviews parsed from `span[role="img"][aria-label*="stars"]` (aria-label "4.7 stars 4,699 Reviews"), innerText `4.7(243)` kept as fallback. Sponsored cards (`h1[aria-label="Sponsored"]`) return null and are skipped wholesale. Website prefers `a[data-value="Website"]` real href (rejects `/aclk`).
- **Bug found by the new test:** legacy `websiteOf` fallback hostname regex `google\.[a-z]{2}$` never matched `google.com`, so an `/aclk?` ad redirect leaked through the generic scan. Fixed (`content/selectors.js`): `google\.[a-z.]{2,}$` + explicit `/aclk` pathname rejection.
- **Two-phase detail visiting** (`content/content.js`): the detail-page `fetch()` path (queueDetailFetch/fetchDetail/phoneFromHtml/websiteFromHtml) **removed**. New phase 2 after the feed is exhausted: builds a visit queue of leads missing phone or website (per selected fields; website-or-email now both trigger, previous code only checked email), then per lead — CAPTCHA gate → find card anchor by mapsUrl prefix (one retry after scrolling feed to top for virtualized cards) → `anchor.click()` (SPA; never location.href) → wait ≤8 s for detail panel (`div[role="main"]` aria-label matching place name, and/or `button[data-item-id="address"]`) → scrape phone (`button[data-item-id^="phone"]`, innerText then aria-label "Phone: …"), website (`a[data-item-id^="authority"]`), full address (`button[data-item-id="address"]` aria-label "Address: …") → `button[aria-label="Close"]` → wait for `[role="feed"]` back (15 s cap) → random 1–2 s → next lead. Skips post DIAG (`phase2-card-not-found`, `phase2-panel-timeout`); every visit posts `phase2-visit` progress DIAG + `LEADS_ENRICHED {jobId, fp, updates}`. DONE (endOfFeed) fires only after the queue drains; STOP drops the queue and DONEs immediately.
- **SW** (`background.js`): `handleLeadEnriched` now also merges **address** — as an upgrade (overwrites the truncated card address; phone/website still fill-blanks-only) — and refreshes `job.lastLeadTs` so the 300 s idle watchdog doesn't kill a long phase-2 drain. New `cfg.visit` block (panel 8 s, feed-return 15 s, 1–2 s visit delay) in `modules/config.js`.
- **Tests** (new `tests/` dir, plain Node scripts, no framework): `mockdom.js` mini-DOM (aria/attr selectors only) + `harness.js` loader; `test-extractors.js` 23 assertions (restaurant/clinic layouts, sponsored, rating, aclk), `test-panel.js` (panel scrape exact values from both phone presentations + address fallback), `test-phase2.js` (5-lead sequence: visit→enrich→close→next order, card-not-found/panel-timeout skips, DONE last; STOP mid-drain → DONE 'stop' with no further enriches; CAPTCHA pause/resume in both loop and visitNext), `test-sw-merge.js` (merge semantics incl. address upgrade + lastLeadTs). All pass; `node --check` clean on all 22 JS files.
- Deviation from prompt: the prompt said skip leads whose panel never opened "log a DIAG and skip" — implemented as phase2-panel-timeout DIAG + skip; also added card-not-found skip (virtualized cards). Address overwrite semantics recorded as [[03 Decisions/Decision Log|D-008]].
**Completed:** Both fixes implemented, mocked-DOM verified, committed locally.
**Pending:** User live test — restaurant search to ~100 leads (clean Category/Address, populated Phone/Website, DONE after visits), clinic regression, DONE-waits confirmation. Run suites via `node tests/test-<name>.js`.
**Blocker:** None.
**Next:** Push to GitHub only when the user says.

## 2026-08-30 — Analysis: restaurant layout breaks parsing; detail-page fetch silently dead → two-phase plan handed off
- Analyzed user's live logs/CSVs + screenshot + **full DOM paste** (feed cards + detail panel, clinic search). Findings recorded in [[02 Architecture/Maps DOM Reference]] ("FULL DOM CAPTURE 2026-08-30"): card hooks (`span[role="img"][aria-label*="stars"]`, `a[data-value="Website"]`, sponsored marker `h1[aria-label="Sponsored"]`), panel hooks (`button[data-item-id="address"]`, `button[data-item-id^="phone"]`, `a[data-item-id^="authority"]`, `button[aria-label="Close"]`, panel = `div[role="main"]` with place-name aria-label).
- **Diagnosis 1:** restaurant cards use a different line composition (`4.7(4,699) · Rs 1,000–7,000` on one line) → line-level filters leak garbage into Category/Address and eat the real data line. Needs per-part classification.
- **Diagnosis 2:** detail-page `fetch()` from the content script returned no place data on the restaurant run (zero phones/websites, zero errors) — page service worker / CSP interception suspected; silent catch hid it. Clinic run unaffected (cards carry phones).
- **Decision (with user):** replace HTML fetching with **two-phase UI visiting** — phase 1 scroll+extract, phase 2 click each place → scrape detail panel (phone/website/better address via `data-item-id` hooks) → close → next. Full handoff prompt saved at [[08 Tasks/Next Session Prompt — Two-Phase Detail Scraping]] for a fresh session. No code written yet (user asked analysis only).
**Completed:** DOM reference updated with full capture; handoff prompt authored and saved to vault.
**Pending:** Next session: implement the two-phase feature + per-part card parsing per the handoff prompt; user live-verifies on restaurant + clinic searches.
**Blocker:** None.
**Next:** New session — start from [[08 Tasks/Next Session Prompt — Two-Phase Detail Scraping]].

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

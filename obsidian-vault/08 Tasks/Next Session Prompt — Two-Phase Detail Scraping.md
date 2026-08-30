---
type: task
created: 2026-08-30
status: ready-to-start
---

# Next Session Prompt — Two-Phase Detail Scraping + Card Parsing Fix

> Handoff note created 2026-08-30. Paste the prompt below into a fresh session to continue. The DOM hooks it references live in [[02 Architecture/Maps DOM Reference]] (full capture section). Do NOT start coding in this session.

## The prompt (copy everything below the line)

---

You are continuing work on the Chrome MV3 extension "Google Maps Lead Extractor" at `C:\Data\Mustafa\Projects\chrome-extention\GMap-lead-scraper`. Read `AGENTS.md` and `obsidian-vault/00 Home.md` first, then `obsidian-vault/02 Architecture/Maps DOM Reference.md` (section "FULL DOM CAPTURE 2026-08-30" — it has all DOM hooks you need), the last 3 entries of `obsidian-vault/01 Project State/Session Log.md`, and `obsidian-vault/08 Tasks/Backlog.md`. The codebase is vanilla JS (no build), classic scripts on the `self.GMLE` namespace, ES5-style. Do NOT push to GitHub unless I say so. Follow the AGENTS.md vault-logging protocol when done.

**Project shape:** content scripts scrape Google Maps (`content/`), a service worker orchestrates (`background.js` + `modules/`), and a Shadow-DOM overlay UI lives in `overlay/`. Message types in `modules/messaging.js` (`GMLE.MSG`), all UI pushes are tab-targeted via `GMLE.postToTab` (runtime broadcasts never reach content scripts). The scroll loop already: scrolls `[role="feed"]` to the bottom, waits single-flight for page growth (`waitForFeedChange`), uses SW-delegated timers when the tab is hidden (`gmSleep`), survives feed removal (feed-lost wait), and the SW restores jobs from IndexedDB after restarts (`ensureJobRestored` with CHECK_JOB/JOB_ACK liveness). Export runs in the SW.

**Two problems to fix (verified against live logs + CSVs from 2026-08-30):**

1. **Card classification breaks on the "restaurant" card layout.** Cards differ per search type: clinic cards show a phone line (phone extraction works); restaurant cards join rating+price on one innerText line — `4.7(4,699) · Rs 1,000–7,000` — so the current line-level filters in `content/extractors.js` leak `Category="4.7(4,699)"` and `Address="Rs 1,000–7,000"`, and the real `Restaurant · <address>` line is then skipped. Fix by classifying **per part** (split each line on `·`), excluding parts that are: rating-shaped (`4.7(4,699)`, `(4,699)`, `4.7`), price (`Rs 1,000–7,000`, currency-prefixed), attribute chips (Family-friendly/Dine-in/etc.), quoted review snippets, status words (Open/Closed/Opens/Closes), and pure numbers/plus-codes handling unchanged. Also upgrade structured fields where possible per the DOM reference: rating/reviews from `span[role="img"][aria-label*="stars"]` (parse the aria-label), **skip cards containing `[aria-label="Sponsored"]`** entirely (they're ads; their "website" link is `/aclk?...`), and fill website from the card's `a[data-value="Website"]` real href when present.

2. **Phone/website for layouts that don't render them in cards.** The current approach (content script `fetch()` of each place URL, `queueDetailFetch`/`fetchDetail`/`phoneFromHtml`/`websiteFromHtml`) silently failed on the restaurant run — intercepted by Google Maps' page service worker or page CSP; zero results, zero errors. **Remove that fetch path** and replace it with a **two-phase UI approach**:
   - **Phase 1 (unchanged):** scroll + extract all leads. Do not fetch anything during scrolling.
   - **Phase 2 (new):** after the feed is exhausted, visit each lead that is missing phone or website (per the selected fields): find the card's anchor in `[role="feed"]` by its `/maps/place/` href (match against the stored `mapsUrl` prefix), click it (SPA navigation — never `location.href`, that would reload and kill the content script), wait for the **detail panel** to open (a `div[role="main"]` whose `aria-label` matches the place name, and/or `button[data-item-id="address"]` appearing; timeout ~8 s → log a DIAG and skip), then scrape: **phone** from `button[data-item-id^="phone"]` (its inner div text or aria-label), **website** from `a[data-item-id^="authority"]` href, **better address** from `button[data-item-id="address"]` text (upgrade the truncated card address), then close via `button[aria-label="Close"]`, wait for `[role="feed"]` to return (reuse the feed-lost waiting), random 1–2 s delay, next lead. Run CAPTCHA detection before each visit (pause path already exists). Post `LEADS_ENRICHED {jobId, fp, updates}` per visited lead (the SW merge handler already exists and fills blanks + re-queues email enrichment). The job's DONE (`finishJobLocal`) must wait until phase 2 drains. Report progress so the overlay shows something (DIAG every lead or small batch; the debug Events/Log tabs display them).
   - Constraints: hooks must be aria/role/data-item-id — never minified class names (Decision D-004; the full hook list is in the DOM Reference note). Keep all timing randomized (1–2 s). ~1.5–3 s per place is acceptable; 100 leads ≈ 3–5 min of visiting.

**Verification before claiming done:** `node --check` on all touched files; mocked-DOM Node tests for (a) restaurant-layout card parsing → Category="Restaurant", real address, no `4.7(4,699)`/`Rs …` leaks, sponsored cards skipped; (b) panel scrape from a small DOM mock of the detail panel (phone via `data-item-id^="phone"`, website via `data-item-id^="authority"`, address upgrade); (c) phase-2 sequence in the loop harness (visit → enrich → close → next). Then I will live-test: run a "restaurant" search to ~100 leads and check the CSV has clean Category/Address and populated Phone/Website; confirm clinic runs still work; confirm DONE waits for the visits.

Update the vault (Session Log, Project State, Modules notes, DOM Reference corrections you discover) per the AGENTS.md protocol. Commit locally; do not push until I say.

---

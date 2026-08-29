# Google Maps Lead Extractor

A local-first Chrome extension (Manifest V3) that extracts business leads from your Google Maps search and exports them to `.xlsx` — with optional email enrichment. Everything runs in your browser: no backend, no accounts, no cloud.

## Features

- **Floating overlay panel** on Google Maps (top-right), collapsible to a small trigger button — never fights with the Maps sidebar.
- **Simple workflow:** open Google Maps, search (e.g. *"dentists in Karachi"*), click **Start extraction**. The extension scrolls the results, detects businesses, and removes duplicates automatically.
- **Live progress:** leads found vs. target, duplicates removed, current business, enrichment status.
- **Email enrichment:** if the *Email* field is selected, the extension visits each business website (bounded concurrency + timeouts) to find contact emails.
- **One-click XLSX export:** auto-downloads when a job completes, or export manually anytime.
- **Private by design:** all data stays in your browser (IndexedDB + local files) unless you export it.

## What gets extracted

Business Name · Category · Rating · Review Count · Address · Phone · Website · Email (via enrichment) · Google Maps URL — each field is individually toggleable in the panel's *Extraction settings*.

## How to run the extension

1. **Download / clone** this repository:
   ```
   git clone https://github.com/SyedMustafaqadri/GMap-lead-scraper.git
   ```
2. **Open Chrome** and go to `chrome://extensions`.
3. Enable **Developer mode** (toggle, top-right).
4. Click **Load unpacked** and select the repository folder (the one containing `manifest.json`).
5. **Open Google Maps**, run a search, then click the extension's toolbar icon — the **Maps Leads** panel appears in the top-right of the page.

### Using it

1. In the panel, check that it says **"Google Maps ready"** and shows your detected search.
2. (Optional) Open **Extraction settings** to set the target lead count and choose which fields to extract.
3. Click **Start extraction**. Leave the tab open and don't interact with the Maps page while it runs (CAPTCHA is detected and handled automatically).
4. When the status pill shows **DONE**, the `.xlsx` downloads automatically — or click **Export XLSX** to download anytime.

> **Note:** The panel only appears after you click the toolbar icon, and only on Google Maps pages. Collapsing the panel does **not** stop a running job; closing the tab or navigating away does.

## Developer tools (optional)

A debug drawer is hidden from regular users. To enable it:

1. Set `GMLE.DEV_MODE = true` in `modules/config.js`.
2. Reload the extension in `chrome://extensions`.
3. A bug icon appears in the panel header, opening a drawer with **State** (live job snapshot), **Events** (real-time message trace), and **Log** (execution logs) tabs, plus a **Demo run** button that generates 60 sample leads without touching Google Maps — useful for verifying the pipeline end-to-end.

## Tech

Vanilla JavaScript, Chrome MV3, no build step. Architecture: content script (Maps DOM, stable `role`/`aria` hooks only), service worker (state machine, dedupe, job management, XLSX export via vendored SheetJS), Shadow-DOM overlay UI. Project knowledge base lives in `obsidian-vault/`.

## Performance & Speed Optimization Guide

This section documents how the extension's execution speed works, the tunables, and the strategies (and hard limits) for making it faster. Read the "why" before turning any knob — the defaults are deliberately conservative.

### How extraction speed is determined

Extraction speed = **how fast Google Maps loads new result pages into the feed**, not how fast we parse. The feed paginates only when scrolled to its bottom, one page (~10–20 results) per request, and its loader is effectively single-flight: requesting the next page while the previous one is still loading gets the request silently dropped and the feed wedges on its loading spinner (this caused the original "stuck at 50–60 leads" bug — see git history, "Fix feed stall"). Every timing knob lives in `GMLE.config.scroll` inside `modules/config.js`:

| Config key | Default | What it controls |
|---|---|---|
| `minDelayMs` / `maxDelayMs` | 1500 / 3500 | Randomized pause between scroll cycles (lower = faster, but more bot-like) |
| `changeWaitPollMs` | 300 | How often we check whether the next page has landed |
| `changeWaitMinMs` / `changeWaitMaxMs` | 5000 / 8000 | Per-cycle budget for waiting on a page load (resolves early the moment content lands) |
| `stepMin` / `stepMax` | 0.8 / 1.5 | Scroll step size, as a fraction of the feed viewport |
| `readPauseEveryMin` / `readPauseEveryMax` + `readPauseMinMs` / `readPauseMaxMs` | every 8–14 cycles, 3–6 s | Occasional "human" pauses (irregular by design) |
| `stallCooldownAfter` / `stallCooldownMs` | 3 cycles / 20 s | One-time cool-down when the feed stops producing |
| `maxConsecutiveNoNew` | 8 | Dead cycles before the job ends as "no results" |

The pacing loop (`content/content.js`) is single-flight by design: extract → wait until the feed actually grows → scroll to the bottom → randomized pause → repeat. Expect roughly **2.5–5 s per page** (~10–20 leads), i.e. ~100 leads in 30–60 s.

### Safe ways to go faster

1. **Lower the between-cycle delay** (`minDelayMs`/`maxDelayMs`) toward 800–2000 ms. This is the biggest lever. The page-load wait resolves as soon as content lands, so the delay is pure pacing. Below ~800 ms the pattern becomes visibly robotic and risks soft-throttling (the stall described above).
2. **Shrink the wait budget** (`changeWaitMinMs`/`changeWaitMaxMs`) to 3–5 s. Only affects how quickly a *stalled* cycle gives up; healthy pages resolve early regardless.
3. **Poll more often** (`changeWaitPollMs` → 150–200 ms). Small, safe gain — a landed page is noticed sooner.
4. **Faster enrichment** (`GMLE.config.enrichment.concurrency`, default 5): raise to 8–10 on a good connection to parallelize website email lookups. Each lookup already has an 8 s timeout (`timeoutMs`) and a 3-page cap (`maxPages`); don't remove those — they prevent hangs (see `modules/enrichment.js`).
5. **Trim extraction fields**: unchecking *Email* in the panel skips enrichment entirely — the single largest per-lead speedup when you don't need emails, since website visits dominate wall time.
6. **Raise the SW idle watchdog** (`scroll.idleTimeoutMs`, default 300 s) only if you raise the stall/cooldown timers proportionally; otherwise the service worker can end long, slow jobs prematurely.

### What not to do

- **Don't remove the single-flight wait** (`waitForFeedChange` in `content/content.js`). Triggering pages while one is mid-load is what wedged the feed originally. It's a correctness mechanism, not overhead.
- **Don't hard-jump to the bottom on a timer** (the original 1.2 s `scrollTop = scrollHeight` loop). Same failure mode, faster.
- **Don't drop the randomized delays and reading pauses.** Fixed metronomic intervals are trivially fingerprintable; Google softly rate-limits pagination when the pattern looks automated.
- **Don't optimize the parser.** DOM extraction is microseconds per card; all wall time is network + deliberate pacing.

### Measured baseline (HAR reference)

A real manual session (Chrome HAR, captured 2026-08-29) showed Google serving each feed page in ~1 s server-side, with a human paginating every ~6–10 s — strictly sequential, zero errors. The extension's defaults sit at ~2.5–5 s/page: roughly 2× faster than that baseline while staying variable and single-flight. If a future run wedges, capture a HAR of the *extension-driven* session and diff the `/search` pagination cadence against this baseline.

### Future optimization ideas (not implemented)

- **Resume instead of restart:** checkpoint-aware resume of an interrupted job would avoid re-scrolling from the top of a search.
- **Detail-panel scraping:** per-place fields (e.g. phone numbers not shown on cards) would trade speed for completeness and need their own concurrency budget.
- **Adaptive pacing:** detect page-load latency, tighten delays when the server responds quickly, back off when it doesn't.

## Disclaimer

Automated extraction may conflict with Google's Terms of Service. This project is for personal use — review the ToS and use responsibly.

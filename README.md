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

## Disclaimer

Automated extraction may conflict with Google's Terms of Service. This project is for personal use — review the ToS and use responsibly.

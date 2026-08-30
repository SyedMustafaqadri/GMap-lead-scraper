---
type: architecture
created: 2026-08-26
status: active
---

# Google Maps DOM Reference (captured 2026-08-26)

> Source: `html-DOM.md` (a DevTools dump of a "clinic" search results page, title `clinic - Google Maps`). The dump was **truncated** — mostly `<head>` + partial body, so it does NOT contain a complete single business card. Recorded here permanently because the source file will be deleted.

## CRITICAL FINDING — class names are obfuscated and rotating

Google Maps is built with the Closure Compiler. CSS classes are **minified and change between builds/sessions** (e.g. `.Ymd7jc`, `.BNHCP`, `.Lnaw4c`, `.UW56ye`, `.GgK1If`, `.Q5g20`, `.C1zbX`, `.HJCejf`, `.W7kqEc`). **Never select on these class names.** They are used below only as clues to what a card contains, not as selectors.

### Stable hooks to rely on instead
- **Search query:** `document.title` ends with ` - Google Maps`; the query is the prefix (`title.replace(/ - Google Maps$/, '')`).
- **App root:** `[aria-label="Google Maps"]` (observed on the main container div; class names around it are noise).
- **Results list (scrollable):** `[role="feed"]` — standard ARIA container for the left results column.
- **Per-business anchor (most stable):** an `<a>` whose `href` contains `/maps/place/`. Each result card contains one. The `href` itself is the **Google Maps URL** field.
- **Phone:** `a[href^="tel:"]` inside the card.
- **Website:** an `<a>` whose `href` is `http(s)://` and whose host is NOT `google.com` (and not a `/maps/place/` link).
- **Schema.org microdata (very stable, appears on place detail & cards):** `itemprop="name"`, `itemprop="telephone"`, `itemprop="url"`, `itemprop="address"`, `itemprop="aggregateRating"`. The `<html>` tag carries `itemtype="http://schema.org/Place"` on place pages (observed: `<html itemscope itemtype="http://schema.org/Place" lang="en">`).
- **Rating/reviews:** element with `aria-label` containing `"stars"`, or text matching `/^([\d.]+)\s*\((\d+)\)/` (e.g. `4.5 (123)`).

## Observed structure fragments (clues only — NOT selectors)
From the `data-late-css` block and body:
- Card container: `.Ymd7jc` — `cursor:pointer; display:flex; flex-direction:column; border-radius:8px; overflow:hidden`. Variant `.BNHCP`.
- `.Lnaw4c` — hover/focus shadow.
- `.W7kqEc.VS46Ee` — image (`object-fit:cover`).
- `.HJCejf` — flex-column body. `.C1zbX` — bordered body.
- `.UW56ye` — text block (`padding:8px 12px 10px; white-space:nowrap; text-overflow:ellipsis; overflow:hidden`).
- `.GgK1If` — primary text color (likely **title**). `.Q5g20` — secondary text color (likely **category/address**). `.y6ocjd` — flex row. `.f7XIc` — secondary text.

## Still UNKNOWN — needs a fuller capture later
- A complete single business card showing phone/website/category/rating/address together in one block.
- The exact scroll container and scroll mechanism (which element receives the scroll / how Maps lazy-loads).
- The visible "end of results" element (text like "You've reached the end of the list").
- CAPTCHA / "unusual traffic" element markers (likely an `iframe[src*="captcha"]` or body text "unusual traffic").

## Recommended extraction strategy (see D-004)
Centralized in `content/selectors.js`. Prefer, in order: `itemprop` microdata → ARIA roles → `href`/`tel:`/`/maps/place/` patterns → text heuristics. Wrap each field extraction in try/catch; on unknown structure, log a warning and leave the field blank (per spec §30: missing field doesn't invalidate a lead). Mark all fields "best-effort until verified on live Maps."

---

# FULL DOM CAPTURE (2026-08-30, pasted from live "clinic" search — feed + opened detail panel)

> Source: user-pasted DevTools HTML of a live clinic search (feed cards + the detail panel of "The Dental Clinic Dr. Saqib Minhas"). Supersedes the truncated 2026-08-26 analysis above. Class names below are STILL minified/rotating — use only the aria/role/data-item-id hooks.

## Feed card (div[role="article"])
- **Card:** `div[role="article"]`. **Place anchor:** `a` with `href` containing `/maps/place/` (may carry `rclk=1` on ad cards); `aria-label` = place name; inner `span` = name text.
- **Sponsored cards must be skipped:** the card contains `h1[aria-label="Sponsored"]`. Their "website" link is an ad redirect (`href="/aclk?..."`), not the business site.
- **Rating/reviews (structured, stable):** `span[role="img"][aria-label="4.7 stars 243 Reviews"]` — parse the aria-label. Inner spans (minified) hold rating `4.7` and count `(243)`.
- **Info lines:** plain `div`s whose innerText is `part · part · part` (the `·` separators are `span[aria-hidden="true"]`). Lines seen:
  1. `Category · [attribute glyph] · Address` — e.g. `Dental clinic · [wheelchair icon] · B276, Street 4 Shahjahan Ave`
  2. `Status · Phone` — e.g. `Closed · Opens 10 AM Mon · <phone>`; status colored span (`Closed` red / `Open` green / `Opens soon`); **phone lives in the last span of this line** (e.g. `0331 2048149`, `+92 21 36641625`).
- **Website (feed card):** `a[data-value="Website"]` with `aria-label="Visit <name>'s website"` — **real href when organic** (e.g. `https://toclinic.net/`); `/aclk?` href when ad. Cards without a site have only `Directions` (`button[data-value="Directions"]`).
- **Review quote:** `div` containing a quoted snippet (e.g. `"Truly caring and experienced."`).
- **LAYOUT VARIANTS (critical, 2026-08-30 live runs):**
  - **Clinic layout:** renders the phone line (cards carry phone numbers) → card-text phone regex works.
  - **Restaurant layout:** NO phone line; line 1 joins rating+price: `4.7(4,699) · Rs 1,000–7,000`, then `Restaurant · B231 Johar Hill Rd`, then `Open · Closes 1:30 AM`, then review quote. innerText-line classification must therefore work on **parts (split `·`)**, not whole lines.
- **Feed footer:** `button[role="checkbox"]` "Update results when map moves" (leave untouched/unchecked).

## Detail panel (opens after clicking a place; SPA, same document)
- **Panel:** a **second** `div[role="main"]` whose `aria-label` = place name (feed's main has `role="feed"` inside). Class names minified.
- **Name:** `h1` inside the panel (aria-label/panel aria-label is the stable hook).
- **Rating/reviews:** `span[role="img"][aria-label="248 reviews"]` next to the rating number.
- **Address (STABLE):** `button[data-item-id="address"]` → `aria-label="Address: <full address>"`; inner `div` holds the text. Much better quality than the card's truncated address.
- **Phone (STABLE pattern, verify live):** info rows use `button[data-item-id="phone:tel:<number>"]` → the display number is in the button's inner `div` text, falling back to an aria-label like `Phone: <number>`. Both presentations are handled by the phase-2 scraper (`scrapePanel` in `content/content.js`); the number is validated with the shared digit-count phone matcher. (Pattern proven by the address row; live-run verification of the exact label still pending.)
- **Website (STABLE pattern):** `a[data-item-id^="authority"]` → `href` is the business site. (Classic Maps hook; verify live.)
- **Category:** a button whose `jsaction` ends in `.category` (minified class) — text is the category.
- **Hours:** `div` with the clock icon + `table` of weekday rows — not needed for export.
- **Close (careful — resets the session):** `button[aria-label="Close"]` at the panel top, wrapped in a jsaction container: `<span jsaction="JIbuQc:aj0Jcf" jslog="146078; track:click; mutable:true"><button class="VfPpkd-icon-LgbsSe …" aria-label="Close" jsaction="click:cOuCgd; mousedown:UX7yZ; …">`. **Clicking it (2026-08-30 Sacramento) fired the jsaction handler's `history.back()` past the search entry — the whole UI reset to the landing URL (`/maps/@lat,lng?entry=ttu`) and the search feed was lost.** Dismissal must therefore try Escape (KeyboardEvent keydown at the panel) and the outer `span[jsaction]` first, verifying the `/maps/search/` route survives (`dismissPanel` in `content/content.js`). History back also nominally restores the feed, but is not reliable. (The `jsaction` tokens are minified — match structure via `closest('span[jsaction]')`, never hardcode them.)

## Implications for the next feature (two-phase detail visiting)
1. Card parsing must be **part-based** (split lines on `·`, classify each part) — line-level filters broke on the restaurant layout (`4.7(4,699) · Rs 1,000–7,000` leaked into Category/Address on the 2026-08-30 restaurant run). ✅ **Implemented 2026-08-30** in `content/extractors.js`.
2. Skip `[aria-label="Sponsored"]` cards entirely. ✅ **Implemented** (`fromAnchor` returns null; `extractAll` skips it).
3. Phones/websites for layouts without card-level data: click the card → scrape the detail panel (`data-item-id` hooks) → close → wait for `[role="feed"]` to return. Do NOT fetch the place URL from the page — it was silently intercepted (page service worker / CSP) and returned no place data (2026-08-30 restaurant run: zero phones, zero errors). ✅ **Implemented 2026-08-30** ([[03 Decisions/Decision Log|D-007]]); the fetch path was removed.
4. Card-level website hook `a[data-value="Website"]` can fill website without visiting (when present and not an ad). ✅ **Implemented** (`selectors.websiteOf` prefers it; `/aclk` rejected; fallback hostname regex fixed to cover `google.com`).

## Related
- [[05 Pitfalls/Do Not Guess DOM]]
- [[02 Architecture/Architecture Map]]
- [[03 Decisions/Decision Log|D-004]]

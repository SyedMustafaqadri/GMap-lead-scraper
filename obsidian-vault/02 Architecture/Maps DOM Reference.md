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

## Related
- [[05 Pitfalls/Do Not Guess DOM]]
- [[02 Architecture/Architecture Map]]
- [[03 Decisions/Decision Log|D-004]]

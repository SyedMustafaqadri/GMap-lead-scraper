---
type: pitfall
created: 2026-08-26
status: seed
---

# Do Not Guess DOM

## Summary
**Never guess Google Maps selectors or extraction logic.** The implementation must be based on the actual inspected HTML.

## Details
Before any implementation code (spec §15, §52, §53):
- Inspect Google Maps in Chrome DevTools and capture real HTML.
- Required samples (§53):
  1. One complete business card
  2. Parent/results container with multiple cards
  3. Actual scrollable results container
  4. Phone element
  5. Website element
  6. Category / rating / review elements
  7. Address element
- Verify which stable identifiers exist (for [[03 Decisions/Decision Log|D-003]] dedupe).
- Investigate loading indicators, end-of-results behavior, CAPTCHA/intervention indicators.
- Don't dump the entire (huge) Maps page — focus on the structures above.

## Findings from captured HTML (2026-08-26)
A truncated DevTools dump (`html-DOM.md`, "clinic" search) was captured and analyzed. Full notes in [[02 Architecture/Maps DOM Reference]]. Headline:
- **Class names are obfuscated & rotating** (Closure Compiler: `.Ymd7jc`, `.BNHCP`, `.UW56ye` …). Do NOT select on them.
- **Stable hooks exist:** `[aria-label="Google Maps"]` root, `[role="feed"]` results list, `a[href*="/maps/place/"]` per-business anchor + Maps URL, `a[href^="tel:"]` phone, non-google `http(s)` `a` website, `itemprop="name|telephone|url|address|aggregateRating"` microdata, rating via `aria-label` "*stars*" or `^([\d.]+)\s*\((\d+)\)$` text.
- A complete single card and the scroll/end-of-results/CAPTCHA markers are still uncaptured — treat extraction as best-effort until verified live.

## Related
- [[00 Home]]
- [[04 Patterns/Engineering Principles]]
- [[02 Architecture/Architecture Map]]
- [[02 Architecture/Maps DOM Reference]]

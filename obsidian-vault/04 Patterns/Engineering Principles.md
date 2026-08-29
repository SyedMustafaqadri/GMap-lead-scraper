---
type: pattern
created: 2026-08-26
status: seed
---

# Engineering Principles

## Summary
The 10 guiding principles from spec §50. Treat these as hard constraints when implementing.

## Details
1. **Don't overbuild** — no backend infra unless proven needed.
2. **Separate concerns** — UI, Maps interaction, orchestration, persistence, enrichment, export stay separate.
3. **Never trust the DOM as storage** — Maps is observed, not our DB.
4. **Never lose extracted data unnecessarily** — checkpoint continuously.
5. **Don't refresh Google Maps automatically** — preserve the session.
6. **Missing fields don't invalidate leads** — no email is still a lead.
7. **Discovery and enrichment are independent** — Maps extraction shouldn't wait on enrichment.
8. **Prefer graceful failure** — pause and notify, not destructive recovery.
9. **Build against the real DOM** — don't guess Maps selectors before inspecting HTML.
10. **Keep UX extremely simple** — ease of use is the product's edge.

## Related
- [[00 Home]]
- [[05 Pitfalls/Do Not Guess DOM]]
- [[03 Decisions/Decision Log]]

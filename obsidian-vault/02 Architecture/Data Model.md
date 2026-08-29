---
type: architecture
created: 2026-08-26
status: seed
---

# Data Model

## Summary
Leads are stored in **IndexedDB** (primary), small metadata in `chrome.storage`, fast state in memory. The DOM is never the database. Excel is generated only at the end.

## Details
### Lead schema (§16, §17)
`Business Name, Category, Rating, Review Count, Address, Phone, Website, Email, Google Maps URL`. Fields are independent/configurable; future: Opening Hours, Lat/Long, Social Links.

### Storage tiers (§20–§21)
- **In-memory `ExtractionJob`:** `jobId, searchQuery, targetLeads, status, startedAt, leads, duplicateCount, enrichmentStats, lastCheckpoint`. Fast, not crash-safe.
- **chrome.storage:** small metadata — current job ID, status, user settings, target, selected fields, timestamps, checkpoint metadata.
- **IndexedDB (primary):** actual lead records, organized per job (`Job A → Lead 1..n`). Enables independent sessions.

### Job isolation (§27)
Every extraction gets a unique `jobId` (e.g. `job_20260826_230512_a81f`). Prevents mixing datasets across browser windows.

### Checkpointing (§22, §23)
Persist every **20 leads OR every 10 seconds** (configurable). Goal: minimize data loss without thrashing persistence. Supports crash recovery + optional Resume.

### Excel export (§24–§26)
- Use a mature JS XLSX library; **never hand-roll the format**.
- `.xlsx` generated only after completion (not continuously edited).
- Naming: `<niche>-<location>-<timestamp>.xlsx`, sanitized for filesystem.

## Related
- [[02 Architecture/Architecture Map]]
- [[03 Decisions/Decision Log]]

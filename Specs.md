# Google Maps Lead Extractor — Product & Technical Specification

## 1. Document Purpose

This document records the product decisions, requirements, technical direction, architecture decisions, and behavioral decisions made during the brainstorming and technical grilling sessions for the **Google Maps Lead Extractor**.

The goal is to create a private Chrome extension for personal and team use that makes Google Maps lead extraction extremely simple:

> **Open Google Maps → search normally → start extraction → let the extension work → receive an Excel file.**

This document is intended to serve as the baseline specification before implementation begins.

---

# 2. Product Overview

## 2.1 Product Name

Working name:

**Google Maps Lead Extractor**

The final name can be changed later.

---

## 2.2 Product Type

A **Chrome browser extension** that works directly alongside Google Maps.

The extension is intended for:

- Personal use
- Internal team use

It is **not initially intended to be a public SaaS product**.

---

## 2.3 Core Product Philosophy

The primary differentiator is **simplicity and ease of use**.

The user should not have to:

- Open another scraping website
- Configure complicated scraping jobs
- Enter Google Maps search parameters into a separate application
- Manually paginate through results
- Manually copy business information

Instead, the user already knows how to use Google Maps.

The intended workflow is:

```text
Open Google Maps
        ↓
Search normally
        ↓
Open the extension sidebar
        ↓
Configure desired fields / target
        ↓
Click START
        ↓
Extension automatically extracts results
        ↓
Extension automatically scrolls
        ↓
Extension discovers more businesses
        ↓
Extension enriches websites/emails when possible
        ↓
User can click STOP at any time
        ↓
Data is saved
        ↓
XLSX file is generated
```

The product should feel like:

> **Search normally. Press Start. Walk away. Get your leads.**

---

# 3. Scope

## 3.1 MVP Scope

The MVP should support:

- Chrome browser
- Google Maps
- User-controlled Google Maps search
- Extension side panel
- Manual Start button
- Automatic extraction
- Automatic scrolling
- Automatic discovery of additional results
- Business deduplication
- Configurable extraction fields
- Phone extraction
- Website extraction
- Category extraction
- Rating/review extraction
- Google Maps location URL
- Address extraction
- Optional email discovery from available websites
- Persistent local data storage
- Checkpointing
- Pause/resume behavior for recoverable problems
- CAPTCHA notification
- Stop button
- XLSX export
- New Excel file per extraction session
- Multiple independent extraction sessions in separate browser windows

---

# 4. Non-Goals for MVP

The following are intentionally excluded from the initial architecture:

- SaaS accounts
- User registration
- Login system
- Subscription/billing
- Cloud database
- Google Sheets integration
- Public multi-tenant application
- Docker deployment
- Remote backend
- FastAPI backend unless later proven necessary
- CRM integration
- Automated outreach
- Email sending
- AI lead scoring
- AI-generated emails
- Large-scale cloud scraping infrastructure

These may become future features but should not complicate the initial implementation.

---

# 5. Target Users

The initial users are:

- The project owner
- Internal team members
- People performing lead generation through Google Maps

The tool is not initially being optimized for a generic public market.

---

# 6. Search Model

The extension does **not** create its own search interface for finding businesses.

The user searches Google Maps normally.

Examples:

```text
dentists in Karachi
restaurants in Lahore
real estate agencies in Dubai
plumbers in London
gyms in Karachi
```

The extension works with whatever relevant Google Maps results are currently displayed.

This is an intentional product decision.

## Principle

> Google Maps handles search and ranking; the extension handles extraction and structuring.

---

# 7. Extraction Workflow

## 7.1 Initial Workflow

```text
1. User opens Google Maps.
2. User searches for the desired niche/location.
3. User opens the extension sidebar.
4. Extension detects the current Maps state/search.
5. User configures extraction options.
6. User clicks START.
7. Extension validates the Maps page.
8. Extraction begins.
9. Business cards are discovered.
10. Business data is extracted.
11. Duplicate records are removed.
12. Website/email enrichment is queued when applicable.
13. Extension automatically scrolls the Maps results.
14. Newly loaded businesses are discovered.
15. Process repeats.
16. User may click STOP.
17. Extraction gracefully finishes.
18. Data is persisted.
19. XLSX is generated.
20. Extraction session completes.
```

---

# 8. User Interaction During Extraction

Once extraction begins, the user should **not interact with the Google Maps page** being processed.

The user should allow the extension to control the extraction process.

The user can use another browser window for another extraction if desired.

Example:

```text
Browser Window 1
Google Maps:
dentists in Karachi
Extraction Job A
```

and:

```text
Browser Window 2
Google Maps:
restaurants in Lahore
Extraction Job B
```

Each extraction is independent.

This is optional user behavior; users are free to run only one extraction if they prefer.

---

# 9. Start Button

The extension sidebar contains a **START** button at the top-right.

Example:

```text
┌──────────────────────────────────┐
│ Google Maps Leads       [ START ]│
├──────────────────────────────────┤
│ Search detected:                 │
│ dentists in Karachi              │
│                                  │
│ Target leads: 500                │
│                                  │
│ Extraction Fields                │
│ ☑ Business Name                  │
│ ☑ Category                       │
│ ☑ Rating                         │
│ ☑ Reviews                        │
│ ☑ Phone                          │
│ ☑ Website                        │
│ ☑ Email                          │
│ ☑ Address                        │
│ ☑ Google Maps URL                │
└──────────────────────────────────┘
```

The extension should not automatically begin scraping merely because Google Maps is open.

The user explicitly starts the extraction.

---

# 10. Search Detection

The extension should detect whether the current tab is actually Google Maps and whether a relevant search/result state exists.

If Google Maps has not been searched yet, the extension should communicate something similar to:

> Search for a business category or niche on Google Maps to begin.

The Start button should only be usable when the extension determines that the page is ready.

The extension should also display the detected search when possible.

Example:

```text
Search detected:
dentists in Karachi
```

---

# 11. Target Lead Count

The user may specify an expected/target number of leads.

Example:

```text
Target leads: 500
```

The target is a **desired quantity**, not necessarily a strict maximum.

If the current batch produces slightly more than the target, those additional discovered leads may be retained.

Example:

```text
Target: 500

Current discovered batch:
499
500
501
502

Final:
502 leads
```

The extension should not intentionally stop processing in the middle of a currently discovered batch merely to hit an exact number.

---

# 12. Extraction Stopping Conditions

Extraction can stop in several ways.

## 12.1 User Stop

The user clicks the STOP button.

The extension then performs a graceful shutdown.

```text
STOP
 ↓
Stop new discovery
 ↓
Stop scrolling
 ↓
Finish currently active enrichment
 ↓
Persist final data
 ↓
Generate XLSX
```

---

## 12.2 No New Results

The extension should detect when Google Maps stops producing new businesses.

The initial timeout decision is:

> **5 minutes without discovering new results.**

However, the system should not immediately assume that no new DOM change means the results are finished.

It should distinguish between:

- temporary loading
- network delay
- CAPTCHA
- page problems
- actual end of results
- Google Maps UI changes
- temporary DOM inactivity

The extraction engine should retry/check before considering the process finished.

---

## 12.3 Target Reached

Reaching the target is not necessarily an immediate hard stop.

The target represents the user's desired quantity.

The extension may finish processing the currently discovered batch before stopping.

---

# 13. Automatic Scrolling

Scrolling is automatic.

The user does not manually scroll the Maps results while extraction is running.

The recommended scrolling strategy is **adaptive scrolling**.

Instead of blindly scrolling at a fixed speed, the extractor should adapt to Maps loading behavior.

Conceptual loop:

```text
Inspect current results
        ↓
Extract new businesses
        ↓
Deduplicate
        ↓
Queue enrichment
        ↓
Check target
        ↓
Scroll results container
        ↓
Wait for Maps/DOM changes
        ↓
Inspect again
        ↓
Repeat
```

The system should avoid aggressive scrolling that could cause missed results or destabilize the page.

---

# 14. DOM Observation

The extraction system should use a combination of:

- DOM observation
- periodic checks
- new business detection
- scroll position
- loading state detection
- timeout logic

`MutationObserver` is a candidate mechanism for detecting changes to the results area.

However, the system should not rely exclusively on MutationObserver because Google Maps is a complex dynamic application.

The recommended approach is a **hybrid event-driven/polling strategy**.

---

# 15. Google Maps DOM

The actual selectors and extraction logic must **not be guessed**.

Before implementation, the actual Google Maps HTML should be inspected.

The user will provide relevant HTML extracted from browser DevTools.

Required HTML examples:

1. One complete business result/card
2. Parent/results container containing multiple cards
3. Actual scrollable results container
4. Phone link/element
5. Website link/element
6. Any relevant category/rating/review elements

The implementation should be based on the real observed DOM.

---

# 16. Extraction Fields

The initial lead schema includes:

| Field | Description |
|---|---|
| Business Name | Name of business |
| Category | Business category |
| Rating | Google Maps rating |
| Review Count | Number of reviews |
| Address | Business address |
| Phone | Business phone number |
| Website | Business website |
| Email | Publicly discoverable email if found |
| Google Maps URL | Location/business link |

The architecture should allow additional fields to be added later.

---

# 17. Configurable Fields

The user wants extraction fields to be configurable.

Potential settings:

```text
☑ Business Name
☑ Category
☑ Rating
☑ Review Count
☑ Address
☑ Phone
☑ Website
☑ Email
☑ Google Maps URL
```

Future/advanced fields may include:

```text
☐ Opening Hours
☐ Latitude
☐ Longitude
☐ Social Links
```

The extraction engine should treat fields independently so adding/removing fields does not require rewriting the entire extraction engine.

---

# 18. Business Deduplication

Duplicates must automatically be removed.

The deduplication system should use a hierarchy rather than relying on a single field.

Recommended identity hierarchy:

```text
Priority 1:
Stable Google Maps / Place identifier

        ↓ fallback

Priority 2:
Google Maps URL

        ↓ fallback

Priority 3:
Normalized phone + normalized business name

        ↓ fallback

Priority 4:
Business name + address
```

The exact availability of stable identifiers must be verified from the actual Google Maps HTML/data.

The system should normalize values where appropriate.

For example:

```text
ABC Dental Clinic
```

and:

```text
ABC Dental
```

may require additional identity signals to determine whether they are the same business.

---

# 19. DOM Recycling

The Google Maps DOM should **not** be treated as the database.

Google Maps may dynamically remove/recycle result cards as the user scrolls.

Therefore:

```text
Google Maps DOM
       ↓
Extract record
       ↓
Our own dataset
```

Once a lead has been captured, it remains in our dataset even if Google Maps removes its card from the DOM.

---

# 20. Local Data Architecture

The project should initially be **local-first**.

No remote backend is required for MVP.

Recommended architecture:

```text
Chrome Extension
│
├── Content Script
├── Side Panel
├── Service Worker
├── chrome.storage
├── IndexedDB
└── XLSX generation
```

---

# 21. Data Storage Strategy

Different storage mechanisms have different responsibilities.

## 21.1 In-Memory State

The currently active extraction job can maintain fast in-memory state.

Example:

```text
ExtractionJob
├── jobId
├── searchQuery
├── targetLeads
├── status
├── startedAt
├── leads
├── duplicateCount
├── enrichmentStats
└── lastCheckpoint
```

This is fast but not sufficient for crash recovery.

---

## 21.2 chrome.storage

Use extension storage for relatively small metadata/configuration.

Examples:

```text
current job ID
job status
user settings
target quantity
selected fields
timestamps
checkpoint metadata
```

---

## 21.3 IndexedDB

IndexedDB should be considered the primary persistent local store for actual lead records.

Conceptually:

```text
IndexedDB

Job A
 ├── Lead 1
 ├── Lead 2
 ├── Lead 3
 └── ...

Job B
 ├── Lead 1
 ├── Lead 2
 └── ...
```

This avoids treating Chrome extension storage as a large database.

It also allows multiple extraction sessions to maintain independent datasets.

---

# 22. Checkpointing

The user explicitly does not want to lose extracted data.

Therefore, extraction progress should periodically be persisted.

Possible checkpoint strategy:

```text
Every X leads
OR
Every X seconds
```

Initial recommendation:

```text
Every 20 leads
OR
Every 10 seconds
```

The exact values can be made configurable after testing.

The goal is to minimize data loss without constantly performing expensive persistence operations.

---

# 23. Crash Recovery

If Chrome crashes or the extension is unexpectedly interrupted, previously checkpointed data should remain available.

Example:

```text
Extraction:
380 leads discovered

Last checkpoint:
347 leads
```

If the application is restarted, the system may offer:

```text
Previous extraction found.

347 leads were saved.

[ Resume ] [ Discard ]
```

Resume functionality is not necessarily required for the first implementation, but the persistence architecture should allow it.

---

# 24. Excel Export

Excel is the final export format.

The extension should generate:

```text
.xlsx
```

rather than relying on CSV as the primary format.

A mature JavaScript XLSX library may be used.

The system should **not implement the XLSX file format manually**.

Conceptual pipeline:

```text
IndexedDB
    ↓
Final dataset
    ↓
XLSX library
    ↓
Workbook
    ↓
Worksheet
    ↓
Download
```

---

# 25. Excel Is Not the Working Database

The `.xlsx` file should not be continuously modified during scraping.

Instead:

```text
Google Maps
    ↓
Extraction Dataset
    ↓
Persistent Local Storage
    ↓
Extraction Complete
    ↓
Generate XLSX
```

This provides better crash recovery and cleaner architecture.

---

# 26. File Naming

Each extraction session should generate a **new Excel file**.

Recommended naming convention:

```text
<niche>-<location>-<timestamp>.xlsx
```

Example:

```text
dentists-karachi-2026-08-26-2305.xlsx
```

Filename generation should sanitize invalid filesystem characters.

---

# 27. Multiple Extraction Sessions

Every extraction receives a unique job ID.

Example:

```text
job_20260826_230512_a81f
```

This prevents different extraction sessions from mixing their data.

Example:

```text
Browser Window 1
    ↓
dentists Karachi
    ↓
Job A
```

and:

```text
Browser Window 2
    ↓
restaurants Lahore
    ↓
Job B
```

Each job maintains its own dataset.

---

# 28. Website Enrichment

Website extraction is part of the lead enrichment process.

If Google Maps provides:

```text
Website:
https://example.com
```

the system may inspect the publicly available website for an email.

Potential discovery locations include:

```text
Homepage
Contact page
About page
Footer
Other publicly available relevant pages
```

---

# 29. Email Is Optional

Email is a best-effort field.

A business does **not** become invalid simply because no email is found.

Example:

```text
Business A → email found
Business B → email unavailable
Business C → email unavailable
```

All three remain leads.

---

# 30. Email Enrichment Failure

If an email cannot be found:

```text
Email = blank/null
```

Then the system continues to the next lead.

Email failure must never block the extraction pipeline.

---

# 31. Extraction vs Enrichment

Discovery and enrichment should be separate pipelines.

Recommended architecture:

```text
                Google Maps
                     │
                     ▼
              Discovery Engine
                     │
                     ▼
                 Lead Queue
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
      Worker 1   Worker 2   Worker 3
          │          │          │
          └──────────┼──────────┘
                     ▼
              Persistent Dataset
                     │
                     ▼
                  XLSX
```

This allows Maps discovery to continue while previous businesses are being enriched.

---

# 32. Enrichment Concurrency

The goal is fast enrichment.

However, the system should not launch hundreds of simultaneous operations without control.

Use a bounded worker pool.

Conceptually:

```text
500 leads
    ↓
5 concurrent workers
    ↓
Worker finishes
    ↓
Next lead enters worker
```

The exact concurrency value should be configurable and adjusted during testing.

---

# 33. Website Timeout

Website enrichment should have a timeout.

A slow website should not block the entire job indefinitely.

Conceptually:

```text
Visit website
    ↓
Timeout threshold
    ↓
No response
    ↓
Mark email unavailable
    ↓
Continue
```

The exact timeout should be determined during implementation/testing.

---

# 34. Error Handling Philosophy

The system should prefer:

> **Pause and preserve data**

over:

> **Refresh and risk losing the extraction state.**

The extension should **never automatically refresh Google Maps as an error-recovery strategy**.

---

# 35. CAPTCHA Handling

CAPTCHA/intervention is considered a first-class extraction state.

When detected:

```text
RUNNING
   ↓
CAPTCHA DETECTED
   ↓
PAUSED / WAITING FOR USER
```

The extension should:

1. Stop automatic extraction.
2. Preserve all existing data.
3. Notify the user.
4. Play a sound notification.
5. Tell the user that intervention is required.
6. Allow the user to solve the CAPTCHA.
7. Detect when the Maps page becomes usable again.
8. Resume extraction.

Example notification:

> CAPTCHA detected. Please solve the CAPTCHA in Google Maps to continue.

The extension should never attempt to bypass the CAPTCHA.

---

# 36. General Error Handling

Possible errors include:

- Results panel disappears
- Google Maps becomes unresponsive
- Network issue
- Unexpected DOM structure
- Extraction selector failure
- Website unavailable
- Website timeout
- CAPTCHA
- Extension interruption

Recommended behavior:

```text
Problem detected
      ↓
Retry when safe
      ↓
Still failing?
      ↓
Pause
      ↓
Notify user
      ↓
Preserve data
```

The system should avoid destructive recovery actions.

---

# 37. Extraction State Machine

The extraction process should explicitly use states.

Initial conceptual states:

```text
IDLE
   ↓
INITIALIZING
   ↓
RUNNING
   ↓
COMPLETING
   ↓
COMPLETED
```

Additional states:

```text
WAITING_FOR_MAPS
PAUSED
WAITING_FOR_USER
CAPTCHA_DETECTED
ERROR
STOPPING
```

Example CAPTCHA flow:

```text
RUNNING
   ↓
CAPTCHA_DETECTED
   ↓
WAITING_FOR_USER
   ↓
CAPTCHA SOLVED
   ↓
RUNNING
```

Example STOP flow:

```text
RUNNING
   ↓
STOPPING
   ↓
FINISH ACTIVE ENRICHMENT
   ↓
PERSIST DATA
   ↓
EXPORT
   ↓
COMPLETED
```

---

# 38. Side Panel

The extension should use a Chrome side panel for the primary UI.

Initial UI concept:

```text
┌──────────────────────────────────┐
│ Google Maps Leads       [ START ]│
├──────────────────────────────────┤
│ Search detected:                 │
│ dentists in Karachi              │
│                                  │
│ Target leads: [500]              │
│                                  │
│ Extraction Fields                │
│ ☑ Business Name                  │
│ ☑ Category                       │
│ ☑ Rating                         │
│ ☑ Review Count                   │
│ ☑ Address                        │
│ ☑ Phone                          │
│ ☑ Website                        │
│ ☑ Email                          │
│ ☑ Google Maps URL                │
└──────────────────────────────────┘
```

During extraction:

```text
┌──────────────────────────────────┐
│ Google Maps Leads        [ STOP ]│
├──────────────────────────────────┤
│ Status: Extracting               │
│                                  │
│ Leads: 347 / 500                 │
│ Duplicates: 29                   │
│                                  │
│ Current:                         │
│ ABC Dental Clinic                │
│                                  │
│ Enrichment: 4 / 5 workers       │
│                                  │
└──────────────────────────────────┘
```

---

# 39. Extraction Status Information

The UI should communicate useful operational information.

Potential metrics:

```text
Leads found
Duplicates removed
Enrichment completed
Emails found
Current business
Current state
Target quantity
```

Percentage progress should not be treated as an accurate measure of total Google Maps availability.

The preferred display is:

```text
347 / 500 leads
```

rather than:

```text
69% complete
```

because the actual number of available Google Maps results is unknown.

---

# 40. Sidebar Closing Behavior

For MVP, closing the sidebar should stop the extraction.

However, extracted data should already have been checkpointed.

Therefore:

```text
Extraction running
      ↓
Sidebar closes
      ↓
Extraction stops
      ↓
Checkpointed data remains safe
```

Future versions may support extraction continuing independently of the sidebar.

---

# 41. Physical Maps Page Locking

The initial recommendation is **not to physically block interaction with Google Maps**.

Instead, the UI should clearly communicate:

> Please do not interact with Google Maps while extraction is running.

Reason:

A physical overlay or interaction blocker could interfere with Google Maps itself and potentially interfere with our automation.

The extension should rely on user cooperation initially.

---

# 42. Browser Architecture

The initial platform is:

> **Chrome only**

Cross-browser support is not an MVP requirement.

Future support for Edge/Firefox may be considered after the Chrome implementation is stable.

---

# 43. Manifest

The extension should use:

> **Chrome Manifest V3**

Conceptual components:

```text
manifest.json
│
├── Side Panel
├── Content Scripts
├── Service Worker
├── Permissions
└── Host Permissions
```

Exact permissions should be minimized and determined during implementation.

---

# 44. Extension Component Responsibilities

## Side Panel

Responsible for:

- User interface
- Start/Stop controls
- Settings
- Target lead input
- Field selection
- Status display
- Notifications

The side panel should not directly perform Google Maps DOM extraction.

---

## Content Script

Responsible for interaction with the Google Maps page.

Potential responsibilities:

- Detect Google Maps state
- Detect search/results
- Locate results container
- Observe DOM changes
- Extract business information
- Scroll the results container
- Detect loading state
- Detect CAPTCHA/interruption
- Report information to service worker

---

## Service Worker

Responsible for coordination.

Potential responsibilities:

- Job management
- Extraction state machine
- Start/stop/pause/resume coordination
- Deduplication
- Persistent state coordination
- Enrichment queue
- Worker management
- Communication with side panel
- Final export coordination

---

# 45. Conceptual Message Flow

```text
Side Panel
     │
     │ START
     ▼
Service Worker
     │
     │ START_EXTRACTION
     ▼
Content Script
     │
     │ inspect Maps
     ▼
Google Maps DOM
     │
     │ extracted businesses
     ▼
Content Script
     │
     │ LEADS_DISCOVERED
     ▼
Service Worker
     │
     ├── Deduplicate
     ├── Persist
     └── Queue enrichment
```

Status flows in the opposite direction:

```text
Service Worker
     ↓
Side Panel

RUNNING
PAUSED
CAPTCHA
STOPPING
COMPLETED
ERROR
```

---

# 46. Recommended MVP Architecture

The current recommended architecture is:

```text
                         GOOGLE MAPS
                              │
                              ▼
                     ┌────────────────┐
                     │ Content Script │
                     │                │
                     │ DOM Extraction │
                     │ Scrolling      │
                     │ Observation    │
                     └───────┬────────┘
                             │
                             │ Messages
                             ▼
                    ┌──────────────────┐
                    │  Service Worker  │
                    │                  │
                    │ State Machine    │
                    │ Job Manager      │
                    │ Deduplication    │
                    │ Queue Management │
                    └────────┬─────────┘
                             │
                ┌────────────┼────────────┐
                │            │            │
                ▼            ▼            ▼
            IndexedDB    Enrichment    Side Panel
                │          Workers         │
                │            │             │
                └────────────┼─────────────┘
                             ▼
                       Final Dataset
                             │
                             ▼
                       XLSX Generator
                             │
                             ▼
                        leads.xlsx
```

---

# 47. Backend Decision

No backend is required initially.

Do not introduce:

- FastAPI
- Flask
- SQLite server
- Docker
- cloud infrastructure

unless testing reveals that the extension itself cannot adequately support the required workload.

If a local backend becomes necessary later:

```text
Chrome Extension
       ↓
localhost
       ↓
FastAPI
       ↓
SQLite
```

can be introduced.

This should be a future optimization, not an MVP dependency.

---

# 48. Why Local-First Architecture Was Chosen

The tool is:

- private
- intended for personal/team use
- not requiring accounts
- not requiring cloud synchronization
- not requiring multi-tenant infrastructure

Therefore a local-first architecture provides:

- simpler development
- fewer dependencies
- no authentication
- no cloud costs
- better privacy
- easier customization
- easier deployment to the team

---

# 49. Future Expansion Possibilities

The current architecture should leave room for future features without requiring a complete rewrite.

Possible future versions:

## V1 — Better Enrichment

- Social media discovery
- More website pages
- Better email extraction
- Website metadata

## V2 — Lead Intelligence

```text
Lead
 ↓
AI analysis
 ↓
Lead score
 ↓
Qualification reason
```

## V3 — Outreach

```text
Lead
 ↓
Research
 ↓
Personalized email
 ↓
Human approval
 ↓
Send
```

## V4 — Local Backend

```text
Extension
 ↓
FastAPI
 ↓
SQLite
 ↓
Advanced job queue
```

These are not part of the current MVP.

---

# 50. Important Engineering Principles

The project should follow these principles:

### Principle 1 — Don't overbuild

Do not add backend infrastructure unless needed.

### Principle 2 — Separate concerns

UI, Maps interaction, orchestration, persistence, enrichment, and export should remain separate.

### Principle 3 — Never trust the DOM as storage

Google Maps is the source being observed, not our database.

### Principle 4 — Never lose extracted data unnecessarily

Checkpoint continuously.

### Principle 5 — Don't refresh Google Maps automatically

Preserve the current session whenever possible.

### Principle 6 — Missing fields don't invalidate leads

A business with no email is still a valid lead.

### Principle 7 — Discovery and enrichment are independent

Maps extraction should not wait unnecessarily for website enrichment.

### Principle 8 — Prefer graceful failure

Pause and notify rather than destructively recovering.

### Principle 9 — Build against the real DOM

Do not guess Google Maps selectors before inspecting the actual HTML.

### Principle 10 — Keep the UX extremely simple

The product's primary advantage is ease of use.

---

# 51. Current Extraction State Concept

The extraction engine should conceptually behave like this:

```text
                ┌──────────┐
                │   IDLE   │
                └────┬─────┘
                     │ START
                     ▼
             ┌───────────────┐
             │ INITIALIZING  │
             └───────┬───────┘
                     │
                     ▼
              ┌────────────┐
              │   RUNNING  │◄─────────────┐
              └─────┬──────┘              │
                    │                     │
          ┌─────────┼─────────┐           │
          │         │         │           │
          ▼         ▼         ▼           │
       CAPTCHA    ERROR     STOP          │
          │         │         │           │
          ▼         ▼         ▼           │
       PAUSED     PAUSED   STOPPING       │
          │         │         │           │
          └────┬────┘         ▼           │
               │        FINISH ENRICHMENT │
               │                │         │
               │                ▼         │
               │            PERSIST       │
               │                │         │
               │                ▼         │
               │             EXPORT       │
               │                │         │
               │                ▼         │
               │           COMPLETED      │
               │                          │
               └────── RESUME ────────────┘
```

This is conceptual and will be refined during implementation.

---

# 52. Pending Technical Investigation

Before implementation, the following must be investigated rather than assumed:

1. Actual Google Maps DOM structure
2. Results container
3. Scrollable container
4. Business-card structure
5. Available business identifiers
6. Phone element
7. Website element
8. Category element
9. Rating/review structure
10. Address structure
11. Google Maps URL structure
12. Loading indicators
13. End-of-results behavior
14. CAPTCHA/interruption indicators
15. Current Chrome extension capabilities
16. Current Google Maps policies/terms relevant to the proposed use
17. Appropriate permissions
18. Appropriate local storage mechanism
19. XLSX library compatibility with Manifest V3
20. Practical concurrency limits for website enrichment

---

# 53. Immediate Next Step

Before writing implementation code, inspect Google Maps in Chrome and provide the relevant HTML.

The most useful material is:

```text
1. One complete business card
2. Parent container containing multiple cards
3. Scrollable results container
4. Phone element
5. Website element
6. Category element
7. Rating/review elements
8. Address element
```

Do **not** provide the entire Google Maps page HTML if it is enormous.

The goal is to understand the actual DOM structure.

Once the HTML is available, the next phase should be:

> **Round 4B — Detailed Technical Architecture**

That phase will define:

- exact extension folder structure
- Manifest V3 configuration
- side-panel architecture
- content-script architecture
- service-worker architecture
- message types
- extraction state machine
- lead data model
- IndexedDB schema
- deduplication algorithm
- scrolling algorithm
- DOM observation strategy
- enrichment queue
- concurrency model
- checkpoint strategy
- XLSX generation
- error handling
- CAPTCHA handling
- job isolation
- configuration system
- testing strategy

Only after those decisions are settled should implementation begin.

# 54. Current Product Definition

The current agreed product can be summarized as:

> **A private Chrome extension that works directly with a user's existing Google Maps search. After the user clicks START, the extension automatically discovers and extracts unique businesses from the Maps results, scrolls adaptively to discover additional results, optionally enriches businesses with publicly available website/email information, persists the extracted data locally, safely pauses when intervention is required, allows the user to stop the job gracefully, and generates a new Excel file for every extraction session.**

**Core UX:**

> **Search → Start → Let it run → Stop or finish → Excel.**

This specification represents the current decisions and should be treated as the baseline for the next technical-design phase.
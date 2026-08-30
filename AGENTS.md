# AGENTS.md — Project Memory & Build Context

**Core Instruction:** Execute efficiently. Avoid overthinking, overengineering, overplanning, or unnecessary refactoring. Focus strictly on the simplest working solution that meets the requirement.

## Where to get current state

This file does **not** track current status. Before planning or doing any work, load the live state from these sources:

- **Current progress / next steps:** `obsidian-vault/00 Home.md` (Quick Context block) and `obsidian-vault/01 Project State/Project State.md`
- **Session history:** `obsidian-vault/01 Project State/Session Log.md`
- **Module-specific state:** `obsidian-vault/06 Modules/<module>.md` (created as code is written)
- **Architecture / data model:** `obsidian-vault/02 Architecture/` — `Architecture Map.md`, `Components.md`, `Data Model.md`
- **Decisions:** `obsidian-vault/03 Decisions/Decision Log.md`
- **Risks & technical debt:** `obsidian-vault/07 Risks & Debt/Risks & Technical Debt.md`
- **Task backlog / investigation list:** `obsidian-vault/08 Tasks/Backlog.md`
- **Full product spec (baseline):** `Specs.md` (repo root)

If a local-only day-by-day plan exists (e.g. `manager_instructions.md`, gitignored), read it before planning work; otherwise use `08 Tasks/Backlog.md` + Project State.

## File visibility rules (agents)

Agents can see **all** files in the workspace, including gitignored ones. Use this scope as follows:

- **Ignore:** `node_modules`, build/dist output (`dist/`, `build/`, `web-ext-artifacts/`), packed extension artifacts (`*.zip`, `*.crx`), logs, OS artifacts (`.DS_Store`, `Thumbs.db`), and package/library/framework internals.
- **Actively use, even if gitignored:** `AGENTS.md`, `obsidian-vault/`, `.agents/` skills, any local-only plan/config files.
- Gitignored files don't reach collaborators via git; anything from them that others need must live in the Obsidian vault.
- This is a **local-first Chrome extension** — there is no backend/DB/frontend server split. The "modules" are extension components: Side Panel, Content Script, Service Worker, Storage, Enrichment, XLSX export.

## Obsidian second brain (do not skip)

`obsidian-vault/` is the project knowledge base and the machine-readable context store.
- **Read `obsidian-vault/00 Home.md` first** for the Map of Content and Quick Context, then load relevant notes before assuming anything.
- Keep `obsidian-vault/01 Project State/Project State.md` accurate after meaningful work.
- **Source of truth hierarchy:** codebase > verified Google Maps DOM/behavior > git history > Obsidian vault > `Specs.md` > assumptions. If sources conflict, flag it — don't silently pick one.
- Record decisions, risks, and blockers in Obsidian, not by duplicating code. Notes explain **why/how**; reference implementation with `path/file.ts:line`, never paste large code blocks.

### Task completion logging protocol (mandatory)

When a task is completed, the agent MUST update the vault in the same session — an unlogged task counts as incomplete. Apply every step that applies; skip steps that don't, but never leave a touched area stale:

1. **Session Log** (`01 Project State/Session Log.md`) — prepend a new entry at the TOP (newest first). Format: `## YYYY-MM-DD — <task name>`, followed by bullets of what was done, deviations, test results, then bold lines **Completed:** / **Pending:** / **Blocker:** / **Next:**. Never rewrite or delete previous entries — they are history.
2. **Project State** (`01 Project State/Project State.md`) — refresh Current Objective, Current Module/Step, Completed, In Progress, Pending, Blocked, Next Actions, and set **Last Verified** to today.
3. **Module note** (`06 Modules/<module>.md`) — update the module you worked on: mark implemented items ✅, tick verification checklist only if actually verified, list remaining work. Create the note if missing.
4. **Architecture** (`02 Architecture/Architecture Map.md`, `Components.md`, `Data Model.md`) — update when system flow, stack, dependencies, message types, or folder layout changed. The map must state the architecture style (**local-first Chrome MV3 extension**) and match the real codebase tree.
5. **Decisions** (`03 Decisions/Decision Log.md`) — append any decision with rationale (numbered `D-0XX`). Only new entries; old decisions are history.
6. **Risks & debt** (`07 Risks & Debt/Risks & Technical Debt.md`) — add newly discovered risks/debt, or update severity/status of existing ones.
7. **Home** (`00 Home.md`) — refresh the Quick Context block and **Last Verified** date so agents get an accurate snapshot.

Rules: use ISO dates (YYYY-MM-DD), keep `[[wikilinks]]` between notes, mark claims verified only if actually tested (per Definition of Done), and keep each note internally consistent — no contradictions between sections of the same file.

## Data & Extension Architecture Guardrails

- **Storage & State Safety:** State must rely on local browser storage (`chrome.storage.local` or IndexedDB). Define explicit interfaces/schemas for extension state before writing storage operations, and update `obsidian-vault/02 Architecture/Data Model.md`.
- **Decoupled Architecture:** Keep Side Panel UI, Service Worker background logic, and Content Script DOM scraping cleanly separated. All communication must pass through structured Chrome extension messaging (`chrome.runtime.sendMessage`).
- **DOM Stability:** Google Maps DOM changes frequently. Wrap DOM parsers/selectors in resilient fallbacks and write clear error-handling wrappers around content scripts.

## Workflow & Vibe Coding Protocols

- **One Task at a Time:** Focus strictly on the active user request. Avoid refactoring surrounding scripts or unrequested files.
- **Test & Verification Protocol:**
  - Run build scripts (`npm run build`) and test suites (`npm test` / unit tests) before marking tasks complete.
  - If a change breaks extension bundle builds or unit tests, resolve the regression before proceeding.
  - Write test specs for scraper logic, data normalization, and export utilities (e.g., XLSX formatting) whenever core logic changes.
- **Git & Atomic Commit Rules:**
  - Inspect `git status` prior to editing code to avoid clobbering uncommitted progress.
  - Commit changes in small, self-contained, logical increments.
  - Standard commit message format: `feat: <brief summary>` or `fix: <brief summary>`.
- **Definition of Done:** Implemented ≠ Tested ≠ Verified ≠ Integrated ≠ Complete. Never claim a feature is complete without build/test verification or explicit manual confirmation steps logged.

## Security

This is a Chrome extension that reads third-party web pages (Google Maps) and may fetch external websites. Always:
- Never commit `.env` or hardcode credentials/API keys/secrets. Use `.env.example` if local secrets are ever needed.
- Honor Manifest V3 CSP: no `eval`, no remote code, no inline scripts; keep `permissions` / `host_permissions` minimal.
- Treat all Google Maps DOM and scraped website content as untrusted: parse safely, avoid XSS when rendering into the Side Panel, sanitize any HTML.
- Don't exfiltrate lead data — the product is local-first; user data stays in the browser unless the user explicitly exports.
- Validate/limit inputs for enrichment fetches (timeouts, size caps) to avoid hangs and memory abuse.
- Mind privilege separation: Content Script (page context) vs Service Worker (extension context) vs Side Panel (UI) — don't leak internals across boundaries unintentionally.

## Development & Test Commands

```bash
npm run dev        # Watch build mode for extension development
npm run build      # Production extension bundle build
npm test           # Run unit test suite (Jest/Vitest/web-ext checks)
npm run lint       # Run linter and type-checking scripts
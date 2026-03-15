# OpenOrchestra — Plan 2: Inbox, Failure Triage & Human-in-the-Loop

**Implemented**: March 2026
**Phases**: 10
**Tests added**: 19 new (417 agent + 176 frontend total, all passing)

---

## Overview

This plan completes the v2 intelligence loop: unfixable failures are automatically escalated, hung processes are killed and surfaced to the user, and a new cross-project Inbox dashboard gives full visibility without leaving the app. macOS native notifications fire for every new inbox item.

---

## What Changed

### Database & Shared Types

- **`shared/src/index.ts`** — Added `InboxItem`, `InboxItemType`, `InboxItemStatus`, `CreateInboxItemParams`, `ResolveInboxItemParams` types
- **`agent/src/db/schema.ts`** — Added `inboxItems` table (FK to runs, jobs, projects with cascade delete). Fixed circular self-reference on `runs.parentRunId` using `AnySQLiteColumn` annotation
- **`agent/src/db/queries/runs.ts`** — Added `failed → permanent_failure` as a valid state transition
- **`agent/src/db/migrations/0010_add_inbox_items.sql`** — Migration for the new table
- **`agent/src/db/queries/inbox-items.ts`** — Full CRUD: `createInboxItem`, `getInboxItem`, `listInboxItems` (optional projectId/status filters), `resolveInboxItem`, `countOpenInboxItems`

### Failure Triage Pipeline

- **`agent/src/executor/self-correction.ts`** — Extended `SelfCorrectionResult` with `notFixable` and `analysisReason` fields
- **`agent/src/executor/failure-triage.ts`** — `triagePermanentFailure(runId, reason)`: promotes run to `permanent_failure`, creates inbox item, emits events
- **`agent/src/executor/index.ts`** — Wired triage after self-correction returns `notFixable: true`; `failPermanently()` also creates inbox items for pre-flight failures

### Human-in-the-Loop

- **`agent/src/executor/hitl-handler.ts`** — `handleInteractiveDetected(runId, reason, abortController)`: aborts the Claude Code process, logs reason, creates `human_in_loop` inbox item
- **`agent/src/executor/index.ts`** — Added `hitlKilledRuns` set; HITL-killed runs resolve as `failed` (not `cancelled`) and are excluded from self-correction retry

### IPC Handlers

- **`agent/src/ipc/handlers/inbox.ts`** — Four handlers:
  - `inbox.list` — filterable by projectId and status
  - `inbox.get` — single item by ID
  - `inbox.count` — open item count (optional projectId)
  - `inbox.resolve` — three actions: `dismiss`, `try_again` (new manual run), `do_something_different` (corrective run with user guidance)
- **`agent/src/ipc/handlers/index.ts`** — Registered inbox handlers

### Frontend

- **`src/lib/api.ts`** — Added `listInboxItems`, `getInboxItem`, `countInboxItems`, `resolveInboxItem`
- **`src/lib/notifications.ts`** — `notifyInboxItem(item)`: sends macOS native notification via Tauri plugin; no-ops gracefully outside Tauri
- **`src/stores/inbox-store.ts`** — Zustand store with `items`, `openCount`, `loading`; always fetches cross-project (no projectId filter)
- **`src/stores/app-store.ts`** — Added `"inbox"` to `ContentView`; default view changed from `"home"` to `"inbox"`; `setActiveProjectId` no longer resets contentView
- **`src/App.tsx`** — Inbox event handlers (`inbox.created`, `inbox.resolved`); inbox count fetched on startup (not project change); notifications triggered on new items

### Unified Inbox Dashboard

The inbox screen combines three panels into one view:

- **`src/components/content/inbox-view.tsx`** — "Needs Attention" alert cards + Overview stat cards (Active Goals, Enabled Jobs, Running/Recent Successes) + Recent Runs list (clickable, shows job name, project badge, status badge, relative time)
- **`src/components/content/inbox-card.tsx`** — Extracted alert card with dismiss / try again / do something different actions (inline textarea for guidance)

### Sidebar Redesign

**`src/components/layout/sidebar.tsx`**:
1. **Logo** — "OpenOrchestra" branded text at top left
2. **Inbox button** — below logo, red badge when open items exist
3. **Project filter** — compact dropdown below Inbox, uniform sizing (same height/icon as Inbox button), "All Projects" as default option
4. **Tree nav** — only rendered when a specific project is selected
5. **Settings** — pinned to bottom

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Inbox is always cross-project | Users need to see all failures regardless of which project is selected |
| `activeProjectId = null` = All Projects | Avoids a separate boolean; null is a valid filter value meaning "no filter" |
| HITL kills → `failed` not `cancelled` | Enables self-correction analysis on the first attempt; marked separately via `hitlKilledRuns` set to prevent retry loop |
| `do_something_different` stores guidance in `correctionContext` | Reuses the existing correction infrastructure; same prompt injection path |
| Combined inbox + dashboard | Reduces navigation; most relevant information (alerts + overview + recent activity) is always one click away |

---

## New Files

| File | Purpose |
|---|---|
| `agent/src/db/migrations/0010_add_inbox_items.sql` | DB migration |
| `agent/src/db/queries/inbox-items.ts` | Inbox CRUD queries |
| `agent/src/executor/failure-triage.ts` | Promote unfixable failures |
| `agent/src/executor/hitl-handler.ts` | Kill hung processes + escalate |
| `agent/src/ipc/handlers/inbox.ts` | IPC handlers for inbox |
| `src/stores/inbox-store.ts` | Frontend Zustand store |
| `src/lib/notifications.ts` | macOS native notifications |
| `src/components/content/inbox-view.tsx` | Unified dashboard screen |
| `src/components/content/inbox-card.tsx` | Alert card component |
| `agent/test/inbox-items.test.ts` | 8 CRUD tests |
| `agent/test/failure-triage.test.ts` | 4 triage tests |
| `agent/test/hitl-handler.test.ts` | 4 HITL tests |
| `src/stores/inbox-store.test.ts` | 7 store tests |

---

## Verification

```bash
# Agent tests (417 passing)
cd agent && npm test

# Frontend tests (176 passing)
npm test

# Typecheck
npx tsc -b
```

Manual E2E at `http://localhost:1420`:
- Create a job with an impossible prompt → verify `permanent_failure` + inbox item + macOS notification
- Test "Try Again" → new manual run created
- Test "Do Something Different" → guidance textarea → corrective run
- Test "Dismiss" → item disappears, badge decrements
- Interactive detection → hung process killed → `human_in_loop` inbox item appears

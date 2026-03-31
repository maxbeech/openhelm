# Changelog

## [0.5.0] - 2026-03-30

### Added
- Multi-thread chat: users can create multiple conversation threads per project with compact horizontal pill tabs
- Thread management: create, rename, delete, clear history, and drag-to-reorder chat threads — all via per-tab dropdown menu
- Auto-rename threads: new threads are automatically given a descriptive title after the first message (non-blocking LLM call)
- Simultaneous conversations: switch between threads while LLM processes in another — each thread tracks its own sending/streaming state independently
- Data Visualizations: chart rendering for data table contents using Recharts (line, bar, area, pie, stat chart types)
- Dashboard redesigned with tabbed layout: Alerts & Actions, System, and Insights tabs
- Insights tab: target progress grouped by goal, data table charts grouped by project
- Visualization auto-suggestion: autopilot deterministically detects numeric data table columns and suggests charts (gated by autopilot mode)
- Charts integrated into goal detail view and job detail panel
- New MCP tools: `list_visualizations`, `create_visualization`, `update_visualization`, `delete_visualization` — AI jobs can create charts during runs
- New `visualizations` DB table (migration 0029) with full CRUD, cascade delete on data table removal
- Suggested charts appear on Dashboard with Accept/Dismiss actions
- Startup backfill: auto-suggests visualizations for existing data tables with sufficient numeric data

### Improved
- Chat response speed: pre-warm embedding model at agent startup (eliminates 2-5s first-message delay)
- Chat response speed: session reuse within tool loops (avoids CLI cold-start on subsequent iterations)
- Chat response speed: cache static system prompt sections (tools, rules, native tools)
- Chat response speed: parallelize async prompt building with sync DB operations
- Chat default model changed from Sonnet to Haiku for faster time-to-first-token (users can still select Sonnet/Opus)

### Refactored
- Extracted chat action handlers to `agent/src/chat/action-handler.ts` (handler.ts file size reduction)
- Extracted print stream parsers to `agent/src/claude-code/print-parser.ts` (print.ts file size reduction)

### Fixed
- Streaming text duplication: deduplicate cumulative text chunks from CLI so streamed responses no longer appear doubled during generation
- Thread tab switching: clicking an inactive thread pill now switches to it correctly; dropdown (rename/delete) is now accessed via a separate chevron button on each pill
- Chat error reporting: extract error details from Claude Code stream-json result events when stderr is empty (fixes unhelpful "no stderr" error messages)
- Chat resilience: auto-retry LLM calls on transient failures (exit code 1, timeouts) with up to 2 retries and exponential backoff

## [0.4.2] - 2026-03-29

### Added
- Target tracking support: track and monitor Claude Code run targets with automatic coordination

### Fixed
- Browser automation efficiencies: reduced resource overhead and improved performance during browser-based Claude Code runs

## [0.4.1] - 2026-03-29

### Added
- Claude Code Usage Dashboard: three stat cards (Today, This Week All, This Week Sonnet) mirroring `/usage` output, with OpenHelm vs total breakdown and comparison to previous period
- 30-day SVG line chart showing token usage trend (total vs OpenHelm), with hover tooltips
- Total usage tracking: reads `~/.claude/projects/**/*.jsonl` to capture all Claude Code sessions (not just OpenHelm-initiated ones); falls back to OpenHelm-only if unavailable
- JSONL deduplication: skips streaming-start placeholder entries by detecting parent→child assistant-turn chains
- Usage alert system: macOS notifications at 50%, 75%, 90% of configurable daily/weekly token budgets; per-threshold deduplication via settings keys prevents repeat alerts within the same period
- New settings keys: `claude_daily_budget` and `claude_weekly_budget` for user-configurable alert thresholds
- New DB table `claude_usage_snapshots` (migration 0027) for per-day usage aggregates
- Health monitoring: reactive detection of Claude Code authentication failures and MCP server unavailability from run stderr
- New dashboard alert types: `auth_required` (with "I've Re-authenticated" action) and `mcp_unavailable`
- Auto-pause scheduler on auth failure to prevent cascading run failures
- Auto-resume interrupted jobs when the user confirms re-authentication via dashboard
- Native macOS notifications for auth and MCP alerts
- Health banner auto-rechecks when auth_required events arrive

## [0.4.0] - 2026-03-29

### Added
- Data Tables: Notion-style structured data tables that both users and AI can create, read, update, and delete
- New "Data" tab in sidebar with table list view and Notion-style grid detail view
- 8 column types: text, number, date, checkbox, select, multi-select, URL, email
- Inline cell editing with type-appropriate editors
- Data Tables MCP server (`openhelm-data`): automatically available in all Claude Code runs, enabling AI to list/query/create/insert/update/delete tables
- Semantic relevance: table schemas are embedded via all-MiniLM-L6-v2 and injected into job prompts when relevant
- Audit trail: all mutations logged with actor (user/ai/system) and run ID
- Type coercion on AI writes: fuzzy-matches select labels, parses string numbers, normalizes dates
- Rate limiting: 100 mutations per MCP tool call to prevent runaway AI loops
- 3 new database tables: `data_tables`, `data_table_rows`, `data_table_changes`

### Fixed
- Chat concurrency guard: prevent sending a second message while the first is still being processed, avoiding concurrent Claude Code CLI processes that could interfere with each other
- Chat stuck-sending fix: clear the sending/status state when switching projects and when error events arrive for a different project thread, preventing the chat input from being permanently locked

## [0.3.1] - 2026-03-28

### Added
- Browser CAPTCHA detection: detects when Claude Code encounters CAPTCHA pages and sends an intervention event so the user can manually solve it
- macOS background process launching: improved handling for spawning browser processes in the background without stealing focus
- Browser process cleanup and intervention handling: prevents zombie processes and tracks user interventions during browser automation runs
- Browser credential injection: credentials marked as "browser" are automatically injected into browser environments before Claude Code runs

### Fixed
- Browser MCP handler now correctly validates environment before attempting browser operations
- Improved test coverage for browser MCP integration and credential handling

## [0.3.0] - 2026-03-28

### Added
- Built-in browser MCP server: integrated stealth-browser-mcp as a bundled MCP server (`openhelm-browser`) with all 95 tools, automatically injected into Claude Code runs via `--mcp-config`
- Per-tool-call timeouts for browser automation: 60s default, 120s for screenshots and heavy operations — prevents indefinite MCP tool hangs that previously caused 600s silence timeouts
- Python venv auto-setup: on first use, detects Python 3.10–3.13 (3.14+ excluded due to pydantic-core/PyO3 compatibility), creates a virtual environment, and installs browser automation dependencies
- IPC handlers (`browserMcp.status`, `browserMcp.setup`) for frontend browser MCP status checks and manual setup
- Orphaned MCP config file cleanup at agent startup
- Browser MCP preference note prepended to job prompts when `openhelm-browser` is available, encouraging Claude to prefer the built-in timeout-protected server over any globally-installed browser MCP unless the prompt explicitly requests a different one

## [0.2.2] - 2026-03-28

### Fixed
- Security: validate username against an allowlist regex before interpolating into the osascript admin shell command in `wake-scheduler.ts`, preventing shell injection if `$USER` contains unusual characters
- Bug: `handleApproveAll` now sorts `create_goal` actions before `create_job` actions so FK links are valid even when the LLM emitted jobs before their parent goal
- Bug: standalone job sort-order query now excludes goal-attached jobs from the `MAX()` calculation, preventing inflated `sortOrder` values for standalone jobs
- Bug: chat message pagination (`beforeId`) now uses `id` as a tiebreaker when two messages share the same `createdAt` timestamp, preventing messages from being silently skipped
- Bug: memory extractor now logs a warning when the LLM returns `action:"update"` without a `mergeTargetId` (previously fell through to create silently)
- UX: inline job name input in sidebar goal nodes now submits on blur (consistent with goal name input behaviour)
- Code clarity: added comments documenting the `"pending"` sentinel goalId convention and the username injection guard

## [0.2.1] - 2026-03-27

### Added
- Per-project chat threads: each project now has its own independent conversation history, and switching projects switches the chat thread
- "All Projects" chat thread: a separate conversation thread is available when viewing all projects, with cross-project read tool access
- Visual thread indicator in the chat panel header showing which project (or "All Projects") the current thread belongs to
- Chat button and panel are now always visible, even when "All Projects" filter is selected

### Fixed
- Fix autopilot system jobs never being generated after goal creation via chat (goalId was extracted from wrong field in pending actions)
- Fix automatic memory extraction never creating memories — CLI structured output (via `--json-schema`) was returned as a `StructuredOutput` tool call / `structured_output` field, but the parser only looked for text blocks, silently returning empty results. This also affected all other `jsonSchema` callers (assessment, plan generation, failure analysis, correction evaluation).
- Fix migration 0021 missing statement-breakpoint markers, causing test DB initialization to fail
- Resolve merge conflict and stabilize agent bundling for v0.2.1 release

### Added
- "Generate" button on goal detail view to trigger autopilot system job creation for existing goals
- Emit `memory.extractionFailed` event on extraction parse failures for better diagnostics

## [0.2.0] - 2026-03-25

### Added
- Support for autopilot: AI-generated plans that run automatically on schedules
- Credential management system for secure API key and token storage

### Fixed
- Suppress benign IPC errors from Sentry to reduce noise in error tracking (OPENHELM-6, OPENHELM-8)
- Credential support and other stability improvements

## [0.1.18] - 2026-03-24

### Added
- Token tracking for background jobs

### Fixed
- Add hourly background update check for improved reliability

## [0.1.17] - 2026-03-24

### Fixed
- Fix execFileAsync bug in agent sidecar

## [0.1.16] - 2026-03-24

### Fixed
- Updated release workflow configuration

## [0.1.15] - 2026-03-24

### Fixed
- Fix updater manifest URLs to use correct repository path

## [0.1.14] - 2026-03-23

### Fixed
- Fix chat messages leaking across projects when switching: all chat events now include `projectId` and frontend filters events by active project; transient state (status text, streaming preview) is cleared on project switch
- Fix AI referencing wrong project's data in chat: context entities (goals, jobs, runs) are now validated against the current project; stale cross-project IDs from frontend selection state are discarded
- Fix blank AI responses in chat when LLM returns only tool calls: handler now provides contextual fallback content; bubble component gracefully handles empty content with pending actions

## [0.1.13] - 2026-03-22

### Fixed
- Minor fixes and stability improvements

## [0.1.12] - 2026-03-22

### Added
- Claude Code health monitoring hook (`use-claude-health`) for real-time CLI status in the UI
- Onboarding email capture step with tests
- Planner commit summarisation (`planner/commit.ts`)
- Native Rust IPC handlers in `lib.rs` for tighter Tauri integration

### Fixed
- Improved Claude Code detector with expanded version/path detection logic
- Chat panel HITL interaction fixes
- Notifications refactor for reliability
- Job query edge-case fixes
- Sidebar job-node display corrections
- Miscellaneous executor, planner prompt, and app-shell stability fixes

## [0.1.11] - 2026-03-20

### Fixed
- Fix onboarding screen showing after app updates: persisted `onboarding_complete` flag in DB so it survives restarts even when project list hasn't loaded yet
- Fix window not being draggable on the "Starting agent" loading screen: added `data-tauri-drag-region` to the splash screen
- Fix agent crash when dev HTTP bridge port 1421 is already in use (e.g. after update restart): EADDRINUSE is now non-fatal instead of crashing the entire agent process
- Fix frontend hanging indefinitely when agent dies: sidecar termination events are now forwarded to the frontend, immediately rejecting all pending requests
- Fix initial load hanging if any startup request fails: wrapped in try/finally so `initialLoading` always completes

### Changed
- Replace static "Starting agent..." text with rotating sailing-themed phrases (e.g. "Hoisting the mainsail…", "Pulling through the fairlead…")

## [0.1.10] - 2026-03-20

### Fixed
- Minor executor, scheduler, and update-flow fixes

## [0.1.9] - 2026-03-20

### Added
- Update-aware run recovery: running tasks are automatically re-enqueued after an app update instead of being marked as failed
- Pre-update active run check: users are warned when active runs exist before installing an update
- "Wait for Runs" option: users can choose to wait for active runs to finish before the update installs automatically
- `executor.prepareForUpdate` and `executor.cancelPrepareForUpdate` IPC handlers for update lifecycle management

### Fixed
- Numerous stability fixes and improvements

## [0.1.8] - 2026-03-19

### Fixed
- Fix "agent not responding" on all downloaded builds: bundled Node.js binary was codesigned with the hardened runtime but without JIT entitlements, causing V8 to crash with "Fatal process OOM in Failed to reserve virtual memory for CodeRange" before emitting any IPC events

## [0.1.7] - 2026-03-19

### Fixed
- Scheduler fixes and stability improvements

## [0.1.6] - 2026-03-19

### Fixed
- Build pipeline fixes and stability improvements

## [0.1.5] - 2026-03-19

### Fixed
- Minor Sentry integration fix

## [0.1.4] - 2026-03-19

### Added
- License system: license manager, IPC handler, license section in settings, and license banner
- Newsletter integration module
- Chat system: chat handler, chat input component, and updated system prompt
- Onboarding wizard expanded with email, payment, and usage-type steps
- Email validation utility and license utilities

### Fixed
- Settings screen and application section improvements
- Shared types updated for new license and chat features

## [0.1.3] - 2026-03-18

### Added
- Chat handler passes working directory to Claude Code so native tools (file read/edit/write) operate in the correct project directory
- `permissionMode` option added to `PrintConfig` / `buildPrintArgs` for controlling Claude Code permission mode per call
- Newsletter email setting now syncs to Resend on save via `subscribeToNewsletter`
- Chat system prompt documents native Claude Code tools (WebSearch, WebFetch, file tools, MCP)
- `disableTools` and `workingDirectory` options exposed on `LlmCallConfig` for per-call control

### Fixed
- Chat LLM timeout increased from 2 minutes to 5 minutes to accommodate native tool use (web search, file reads)
- `disableTools` now defaults to `true` globally but can be overridden per call (chat disables it to allow native tool use)

## [0.1.2] - 2026-03-18

### Added
- Auto-updates via Tauri updater plugin integrated with GitHub Releases

### Fixed
- ESLint v9 flat config (`eslint.config.js`) added for linting compatibility

## [0.1.1] - 2026-03-18

### Added
- Power management: sleep guard and wake scheduler to keep scheduled jobs running reliably on macOS
- Newsletter opt-in step in onboarding wizard
- GitHub star dialog for community engagement

### Fixed
- CI workflow improvements: fail-fast disabled for build matrix, tsbuildinfo files gitignored
- Release workflow updated to use macos-latest for both targets
- Bundle identifier changed to com.maxbeech.openhelm
- /release command updated to use small/medium/large bump types

## [0.1.0] - Unreleased

### Robustness Improvements
- **Timeout default changed to unlimited**: Hard wall-clock timeout now defaults to 0 (no limit). The silence timeout (10 min) independently catches stuck processes. Users can still opt in to a hard cap via Settings > Execution. Dropdown now includes "No limit" as the first option.
- **Orphaned queued runs safety net**: Scheduler tick now checks for DB runs stuck in "queued" status that aren't in the in-memory queue, and re-enqueues them. This prevents corrective runs (or any run) from being permanently stuck after an agent hiccup.
- **Crash recovery priority fix**: Corrective runs re-enqueued during crash recovery now get priority 2 (was incorrectly 1), matching their original enqueue priority.
- **Renamed correctionContext → postPrompt on jobs**: The job-level `correctionContext` field is now `postPrompt` — a user-facing, editable field. It's auto-populated by self-correction on failure, but users can also set it manually via the job creation/edit forms. Both `postPrompt` (persistent on jobs) and `correctionContext` (per-run snapshot) are appended to the effective prompt, with postPrompt first. DB migration 0012 renames the column.

### Fixed (End-to-End Verification)
- **runner.ts**: Added missing `--verbose` flag required by Claude Code CLI v2.1.71 when using `--print --output-format=stream-json`. Without it all jobs failed immediately with exit code 1.
- **job-creation-sheet.tsx**: Once-type manual jobs set `fireAt: new Date()` which was already past by the time `createJob` ran, causing `nextFireAt = null` and the job never firing. Fixed with `+10_000ms` buffer (same pattern as `commit.ts`).
- **goal-creation-sheet.tsx**: Pre-fill bug — `useState(initialGoalText)` only initialises at mount; added `useEffect` to sync `goalText` when the sheet re-opens with new `initialGoalText`.
- **App.tsx**: `activeProjectId` was being stored under key `"theme"`. Fixed to use key `"active_project"`.
- **commit.ts**: Once-jobs created with `fireAt: new Date()` were immediately past. Fixed with `ONCE_FIRE_BUFFER_MS = 10_000`.
- **App.tsx + runs-screen.tsx**: `run.created` and `run.statusChanged` event handlers were only registered in `RunsScreen`. When the user was on the Jobs screen, scheduled runs appeared as "Never" until navigating to Runs and back. Moved handlers to `App.tsx` (global, always-active) and removed duplicates from `RunsScreen`.


### Added
- Project scaffold: Tauri 2 + React 18 + TypeScript + Tailwind CSS 4
- Node.js agent sidecar with stdin/stdout IPC
- SQLite database with WAL mode (via better-sqlite3 + Drizzle ORM)
- Shared IPC type contract (`@openhelm/shared`)
- Ping/pong IPC round-trip proving end-to-end communication
- Settings table (key-value store) as initial schema

### Phase 1 — Data Layer & Core CRUD
- Full database schema: Projects, Goals, Jobs, Runs, RunLogs, Settings
- Drizzle ORM migration for all entity tables with cascade deletes
- Query layer with named functions per entity (`agent/src/db/queries/`)
- Schedule computation (once, interval, cron) with validation (`agent/src/scheduler/schedule.ts`)
- IPC handler layer with domain-specific handlers (`agent/src/ipc/handlers/`)
- Typed frontend API wrapper (`src/lib/api.ts`) for all CRUD operations
- Shared type contract expanded with all entity types and IPC method params
- 70 unit tests covering all queries, schedule logic, and cascade behaviour
- Debug panel in UI showing project list from real database

### Phase 2 — Claude Code Integration
- ClaudeCodeRunner (`agent/src/claude-code/runner.ts`) — sacred single module for spawning Claude Code CLI
  - Uses `-p --output-format stream-json` for headless streaming execution
  - Real-time output streaming via line-buffered stdout/stderr parsing
  - Timeout management with SIGTERM → SIGKILL escalation (5s grace period)
  - Cancellation support via AbortSignal
  - Configurable permission mode and budget limits
- CLI auto-detection (`agent/src/claude-code/detector.ts`)
  - Searches PATH (via `which`), Homebrew, and npm global install locations
  - Version detection and minimum version enforcement (v2.0.0+)
  - Persists detection results to settings table
  - Re-verifies stored path on startup, auto-re-detects if stale
- Interactive prompt detection (`agent/src/claude-code/interactive-detector.ts`)
  - Pattern matching for y/n prompts, password inputs, confirmation dialogs
  - Silence detection (60s configurable threshold)
  - Triggers callback instead of killing process (preserves partial work)
- Stream parser (`agent/src/claude-code/stream-parser.ts`)
  - Parses Claude Code `stream-json` output into human-readable log entries
  - Extracts text, tool use summaries, and result metadata (cost, duration, turns)
  - Truncates long tool results for log readability
- IPC emitter extracted to reusable module (`agent/src/ipc/emitter.ts`)
- IPC handlers for `claudeCode.detect`, `claudeCode.verify`, `claudeCode.getStatus`
- Frontend API wrappers for Claude Code detection operations
- Shared types: `ClaudeCodeDetectionResult`, `ClaudeCodeRunConfig`, `ClaudeCodeRunResult`
- New setting keys: `claude_code_version`, `run_timeout_minutes`
- Auto-detection runs on agent startup, emits `claudeCode.detected` event
- 42 new tests (112 total): detector, runner, interactive detector, stream parser

### Phase 3 — Scheduler & Executor
- In-memory priority queue (`agent/src/scheduler/queue.ts`)
  - Priority levels: 0=manual, 1=scheduled, 2=corrective
  - FIFO ordering within same priority level
  - Singleton instance shared between scheduler and executor
- Scheduler (`agent/src/scheduler/index.ts`)
  - 1-minute tick interval querying for due jobs (`nextFireAt <= now`)
  - Creates run records and enqueues them automatically
  - Updates `nextFireAt` after each enqueue (interval: completion+minutes, once: disable, cron: next future)
  - Callback-based notification to executor via `setOnWorkEnqueued`
- Executor (`agent/src/executor/index.ts`)
  - Worker pool consuming from priority queue
  - Configurable concurrency: default 1, max 3, via `max_concurrent_runs` setting
  - Full run lifecycle: pre-flight checks → mark running (DB before spawn) → ClaudeCodeRunner → completion
  - DB insert before IPC emit invariant for log ordering
  - Pre-flight checks: job existence, project directory existence, Claude Code path
  - `permanent_failure` status for unrecoverable pre-flight failures
- Crash recovery on agent startup
  - Stuck "running" runs → failed with explanatory log entry ("agent restart")
  - Orphaned "queued" runs → re-enqueued with correct priority
- Run status state machine enforcement (`agent/src/db/queries/runs.ts`)
  - Valid transitions enforced at query layer; invalid transitions throw errors
  - Terminal states (succeeded, failed, permanent_failure, cancelled) have no outgoing edges
- IPC handlers for `runs.trigger`, `runs.cancel`, `scheduler.status`
  - Manual trigger creates run with priority 0 (highest) for immediate execution
  - Cancel supports both queued (queue removal) and running (abort signal) runs
- Shared types: `TriggerRunParams`, `CancelRunParams`, `SchedulerStatus`
- Frontend API wrappers: `triggerRun()`, `cancelRun()`, `getSchedulerStatus()`
- Due job query: `listDueJobs()` and `disableJob()` added to jobs query layer
- 50 new tests (162 total): queue (10), state machine (13), scheduler tick (10), executor (17)

### Phase 4 — LLM Layer & AI Planning
- Custom LLM layer (`agent/src/llm/`)
  - `client.ts`: Thin Anthropic SDK wrapper with typed error hierarchy (`LlmError`)
    - Reads API key from settings table (not env vars)
    - Model tiers: `claude-sonnet-4-6` (planning), `claude-haiku-4-5-20251001` (classification)
    - Maps SDK errors to typed codes: missing_api_key, authentication_failed, rate_limited, etc.
  - `loop.ts`: Agent loop for tool-calling interactions
    - Configurable max iterations (default 3), safety-bounded execution
    - Accumulates token usage across all iterations
    - Handles single and parallel tool use in one response
  - `tools.ts`: Planning tool definitions and executors
    - `validate_cron_expression`: validates + returns next 3 human-readable occurrences
    - `get_current_datetime`: returns ISO, local, timezone, and day of week
- Planner module (`agent/src/planner/`)
  - `assess.ts`: Fast classification call to determine if goal needs clarification
    - Max 2 questions (hardcoded limit), multiple-choice with free-text option
    - Errs strongly on the side of NOT asking questions
  - `generate.ts`: Full agent loop producing structured job plans
    - Validates 2-6 jobs, each with name, description, prompt, rationale, schedule
    - Strips markdown fences from LLM output, validates schedule types
  - `commit.ts`: Atomic database transaction for plan commitment
    - Creates goal + all jobs in single transaction (all or nothing)
    - Once-jobs: `nextFireAt` set to now (fires within one scheduler tick)
    - Recurring jobs: `nextFireAt` computed forward from current time
  - `prompts.ts`: System prompts for assessment and plan generation
- IPC handlers: `planner.assess`, `planner.generate`, `planner.commit`
- Shared types: `AssessmentResult`, `ClarifyingQuestion`, `PlannedJob`, `GeneratedPlan`, `CommitPlanResult`, plus IPC param types
- 46 new tests (208 total): llm-client (5), llm-loop (7), llm-tools (8), planner-assess (9), planner-generate (10), planner-commit (7)

### Phase 5 — Core UI
- Design system and visual language (`src/styles/globals.css`)
  - Deep navy colour palette with warm amber accent
  - Tailwind CSS 4 theme tokens via `@theme inline`
  - Custom animations: `pulse-border` for running states, `pulse-dot` for sidebar indicators
  - Dark-themed scrollbar styling, monospace log viewer typography
  - `tw-animate-css` for shadcn/ui component transitions
- 17 shadcn/ui primitive components installed (button, input, textarea, label, badge, switch, select, sheet, dialog, card, separator, skeleton, scroll-area, dropdown-menu, radio-group, progress, tooltip)
- Application shell and navigation (`src/components/layout/`)
  - `AppShell`: fixed sidebar + main content layout
  - `Sidebar`: project selector dropdown, 4-item navigation (Goals, Jobs, Runs, Settings), live count badges with pulse animation for running runs
- Zustand stores (`src/stores/`)
  - `app-store`: page routing, navigation filters, active project, onboarding state, agent readiness
  - `project-store`: project CRUD with async fetching
  - `goal-store`: goal listing and status updates
  - `job-store`: job listing, enable/disable toggle, delete
  - `run-store`: run listing, manual trigger, cancel, real-time status updates
- Custom React hooks (`src/hooks/`)
  - `useAgentEvent`: subscribes to agent events via `CustomEvent` on `window`
  - `useRunLogs`: write-through buffer pattern for log streaming (100ms flush interval)
  - `useAutoScroll`: auto-scroll with user scroll detection and "Jump to latest" support
- Onboarding wizard (`src/components/onboarding/`)
  - 5-step flow: Welcome → Claude Code detection → API key → First project → Complete
  - Gates entire application until onboarding is complete
  - Auto-detection of Claude Code with manual path override
  - API key input with masked display and test functionality
  - Native directory picker via `@tauri-apps/plugin-dialog`
- Goals screen (`src/components/goals/goals-screen.tsx`)
  - Prominent goal input with example chips
  - Responsive goal card grid with status, job count, latest run, next fire time
  - Animated border on cards with running jobs
- Goal creation sheet (`src/components/goals/goal-creation-sheet.tsx`)
  - 4-step slide-over: Goal input → Clarification (conditional) → Plan review → Confirmation
  - Clarification step: radio chips with "Something else" free-text option
  - Plan review: editable job cards with name, prompt, schedule; add/delete jobs
  - Human-readable schedule display for all schedule types
  - Summary banner showing job counts and schedule breakdown
- Jobs screen (`src/components/jobs/`)
  - Table view with goal filter dropdown and show/hide disabled toggle
  - Columns: name, goal, schedule, enabled toggle, last run status, next fire time
  - Right-side detail panel with prompt, schedule, run now button, run history
  - "Run now" confirmation when a run is already in progress
- Runs screen (`src/components/runs/`)
  - Table view with job and status filter dropdowns
  - Real-time status updates via `run.statusChanged` events (no polling)
  - Trigger source labels (Scheduled / Manual / Corrective)
  - Right-side detail panel with status banner, cancel button, AI summary, log viewer
- Run status banner (`src/components/runs/run-status-banner.tsx`)
  - Full-width coloured banners: amber (running), green (succeeded), red (failed)
  - Live elapsed time counter updating every second for running runs
- Log viewer (`src/components/runs/log-viewer.tsx`)
  - Monospace display with stdout/stderr colour differentiation
  - Write-through buffer pattern: events buffered in `useRef`, flushed to state at 100ms intervals
  - Auto-scroll during live runs, pauses when user scrolls up
  - "Jump to latest" button appears when user scrolls up during live run
  - Search with highlight support
- Settings screen (`src/components/settings/settings-screen.tsx`)
  - Claude Code: detected path/version display, manual path override
  - Anthropic API: masked key display, change/add key
  - Execution: max concurrent runs (1-3), default timeout (10-120 minutes)
  - Application: version display, external links
- Shared components (`src/components/shared/`)
  - `RunStatusBadge` / `GoalStatusBadge`: coloured badges with icons for all statuses
  - `EmptyState`: icon + title + description + optional action
  - `LoadingSkeleton`: card, table row, and list skeleton variants
  - `NewProjectDialog`: project creation dialog for adding projects post-onboarding
- Utility functions (`src/lib/format.ts`)
  - `formatSchedule`: human-readable schedule descriptions for once/interval/cron
  - `formatRelativeTime`: relative time strings (just now, 5m ago, in 2h)
  - `formatDuration`: elapsed time formatting (<1s, 45s, 2m 5s, 1h 2m)
  - `getElapsed`: duration calculation between ISO dates
- Frontend API additions
  - Planner wrappers: `assessGoal()`, `generatePlan()`, `commitPlan()`
  - `projectId` filter added to `ListRunsParams` for project-scoped run queries
- Frontend test infrastructure
  - Vitest config with jsdom environment, React testing library
  - Tauri API mocks for testing without native runtime
  - 45 new tests (254 total): stores (10), format utils (20), hooks (3), components (12)

### Phase 6 — Real-Time Event Wiring
- (Completed previously — event bus, live log streaming, status updates)

### Phase 7 — Manual Job Creation
- Manual job creation sheet (`src/components/jobs/job-creation-sheet.tsx`)
  - Accessed via "New job" button on Jobs screen header
  - Fields: Name (required), Prompt (required, with char count), Goal association (optional dropdown of active goals), Schedule (Once/Interval/Cron with dynamic config fields), Working directory (defaults to project dir)
  - Prompt clarity check via LLM assessment on submit; shows inline clarification questions if needed
  - "Create anyway" escape hatch for users who know what they want
  - Appends clarification answers to prompt as additional context
  - Resets form state on close
- Prompt clarification component (`src/components/jobs/prompt-clarification.tsx`)
  - Inline display of 1-2 clarifying questions with radio chip options
  - "Other" free-text option for each question
  - Styled with primary accent border to draw attention
- Prompt assessment backend (`agent/src/planner/assess-prompt.ts`)
  - Uses classification model (Haiku) for fast assessment
  - Prompt-specific system prompt (softer than goal assessment — manual creation implies intentionality)
  - Max 2 questions, capped at 5 options each
  - IPC handler: `planner.assessPrompt`
- `workingDirectory` field added to Job entity
  - New nullable column in SQLite schema (migration `0002_icy_phil_sheldon.sql`)
  - Executor uses job's `workingDirectory` when set, falls back to project directory
  - Available in `CreateJobParams` and `UpdateJobParams`
- Job store `createJob` action — prepends new job to list
- Frontend API: `assessPrompt()` wrapper
- Shared types: `AssessPromptParams`, `PromptAssessmentResult`
- 37 new tests (291 total): prompt assessment (9), job store (4), creation sheet (6), clarification component (5), existing suites unchanged

### Phase 9 — Eliminate Anthropic API Key
- Removed `@anthropic-ai/sdk` dependency entirely
- All internal LLM calls (planning, assessment, summarisation) now route through Claude Code CLI in `--print` mode
  - New `agent/src/claude-code/print.ts`: lightweight CLI wrapper for single-turn completions
  - New `agent/src/planner/llm-via-cli.ts`: adapter translating planner needs into CLI calls
  - New `agent/src/planner/cron-validator.ts`: standalone cron validation utility
- Users no longer need a separate Anthropic API key — only a Claude Code subscription
- Removed `anthropic_api_key` from `SettingKey` union type
- Removed API key step from onboarding wizard (5 steps → 4 steps)
- Removed API key section from settings screen
- Deleted `agent/src/llm/` directory (client.ts, loop.ts, tools.ts, index.ts)
- Deleted `src/components/onboarding/steps/api-key-step.tsx`
- IPC error handling updated: `PrintError` replaces `LlmError`
- Datetime context now inlined in plan generation prompt (replaces `get_current_datetime` tool)
- Post-generation cron validation replaces `validate_cron_expression` tool
- One-time cleanup on agent startup removes any stored legacy API key
- Model selection: `sonnet` alias for planning, `claude-haiku-4-5-20251001` for classification
- 16 new/rewritten tests, 20 tests deleted (net: 234 agent tests, down from 254 due to removed LLM layer tests)

### Phase 8 — Polish, Hardening & Distribution

#### 8.1 Comprehensive Error Handling
- Typed LLM error propagation through IPC (`agent/src/ipc/handler.ts`)
  - `LlmError` instances mapped to dedicated IPC error code `-32001` with human-readable messages
  - Per-code user-friendly messages: missing_api_key, authentication_failed, rate_limited, overloaded, network_error, timeout, invalid_request, unknown
- Executor preflight checks enhanced (`agent/src/executor/index.ts`)
  - Claude Code binary existence check via `existsSync` (not just config presence)
  - Actionable messages for missing CLI path, missing binary, missing project directory
  - All preflight failures produce `permanent_failure` with clear guidance
- Database initialization error handling (`agent/src/db/init.ts`)
  - `SQLITE_FULL` caught and surfaced as "Your disk may be full"
  - Generic init failures include database path in error message
- Malformed LLM response retry (`agent/src/planner/assess.ts`, `agent/src/planner/generate.ts`)
  - Single automatic retry on JSON parse failures before surfacing error
  - Console logging on retry for debugging
- Agent crash handlers (`agent/src/index.ts`)
  - `uncaughtException` and `unhandledRejection` handlers emit `agent.error` event before exit
- Frontend `friendlyError` utility (`src/lib/utils.ts`)
  - Extracts human-readable messages from JSON-RPC errors, timeout errors, and raw exceptions
  - Used in all Zustand store catch blocks (goal, job, run stores)
- Reusable `ErrorBanner` component (`src/components/shared/error-banner.tsx`)
  - AlertTriangle icon, message, optional Retry and Dismiss buttons
- Agent timeout detection in `App.tsx`
  - 15-second timeout on agent readiness with error UI and Restart button (`relaunch_app` Tauri command)
- 22 new tests: IPC error mapping (7), friendlyError utility (7), ErrorBanner component (8)

#### 8.2 Empty States
- Goals screen: descriptive guidance text directing users to type their first goal
- Jobs screen: dual empty states — no jobs at all (with "Set a goal" + "Create job" action buttons) vs. filtered to empty (filter-specific message)
- Runs screen: dynamic empty description showing next scheduled run time when jobs with `nextFireAt` exist
- Run detail panel: summary section for running state ("Summary will appear when the run completes.") and terminal with no summary ("Summary unavailable.")

#### 8.3 Performance — Virtualized Log Viewer
- Log viewer rewritten with virtual scrolling (`src/components/runs/log-viewer.tsx`)
  - Only renders visible lines plus overscan buffer (~60-80 DOM nodes regardless of total log count)
  - Constants: `LINE_HEIGHT = 20px`, `OVERSCAN = 20 lines`, `BOTTOM_THRESHOLD = 30px`
  - `ResizeObserver` for responsive container height tracking
  - Auto-scroll tracking via `wasAtBottomRef` — pauses when user scrolls up, resumes at bottom
  - "Jump to latest" button when user is scrolled up during live run
  - Handles 10,000+ log lines without freezing or scroll jank

#### 8.4 macOS Integration
- Dock behaviour: hide-on-close via `on_window_event` handler in `lib.rs`
  - `CloseRequested` → `api.prevent_close()` + `window.hide()` — agent keeps running in background
  - macOS "Quit" menu item still terminates the app normally
- Launch at login: `tauri-plugin-autostart` with `MacosLauncher::LaunchAgent`
  - Toggle in Settings screen under Application section
  - Invokes `plugin:autostart|enable` / `plugin:autostart|disable` via Tauri invoke
- Notification permission: requested on first launch via `tauri-plugin-notification`
  - Checks `notification_permission_requested` setting to avoid repeat prompts
  - Requests permission early (not at notification time) per macOS UX best practice
- Native file picker: `tauri-plugin-dialog` registered for directory selection throughout the app
- `relaunch_app` Tauri command added for restart functionality
- Rust plugins added to `Cargo.toml`: `tauri-plugin-autostart`, `tauri-plugin-notification`, `tauri-plugin-dialog`, `tauri-plugin-updater`
- Capabilities updated with permissions for all four plugins
- `macOSPrivateApi` enabled in `tauri.conf.json` for dock behaviour support

#### 8.5 Build Pipeline & Distribution
- GitHub Actions release workflow (`.github/workflows/release.yml`)
  - Triggers on `v*` tag push, builds on `macos-latest` (Apple Silicon)
  - Installs Node 20, Rust stable (aarch64 + x86_64 targets), npm dependencies
  - Builds agent sidecar and copies to `src-tauri/binaries/` with Tauri target-triple naming
  - Imports Apple Developer certificate for code signing (optional, via secrets)
  - Uses `tauri-apps/tauri-action@v0` for build, sign, notarize, and GitHub Release creation
  - Attaches DMG and `latest.json` updater manifest to release
  - Secrets: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`
- GitHub Actions CI workflow (`.github/workflows/ci.yml`)
  - Runs on PRs to main and pushes to main
  - `lint-and-test` job: TypeScript type-check, ESLint, full test suite
  - `build-check` job: agent sidecar build + Rust `cargo check` compilation verification
  - Concurrency groups cancel in-progress runs for same branch/PR
- Tauri auto-updater integration
  - `tauri-plugin-updater = "2"` added to Rust dependencies
  - Plugin registered in `lib.rs` via `.plugin(tauri_plugin_updater::Builder::new().build())`
  - Updater configured in `tauri.conf.json` plugins section with GitHub Releases endpoint
  - `updater:default` permission added to default capabilities
- 24 new tests (315 total): IPC error mapping (7), friendlyError (7), ErrorBanner (8), executor preflight (1), planner retry fixes (1)

### End-to-End Verification Bug Fixes

#### Live Log Streaming (Critical)
- Fixed `RunLogEvent` interface mismatch in `src/hooks/use-run-logs.ts`
  - Agent emits individual events `{runId, sequence, stream, text}` but handler expected `{runId, logs: Array<...>}`, causing `data.logs.map is not a function` TypeError on every log event
  - Corrected interface to match single-line agent emission; log streaming now works correctly

#### Scheduled Runs Not Appearing in UI
- Fixed missing `run.created` event emission in `agent/src/scheduler/index.ts`
  - Scheduler only emitted `run.statusChanged` but the runs screen listens for `run.created` to refresh the list; scheduled runs were invisible until manual page refresh
- Applied same fix to manual trigger handler in `agent/src/ipc/handlers/scheduler.ts`

#### Run Duration Always Showing "< 1s"
- Fixed `run.statusChanged` events missing timing fields in `agent/src/executor/index.ts`
  - Running transition now includes `startedAt` in the event payload
  - Terminal transition now includes `finishedAt` and `exitCode` in the event payload
- Updated `handleStatusChange` in `src/components/runs/runs-screen.tsx` to apply all timing fields from events to the in-memory run store (conditional spread prevents null/undefined overwrites)

#### Active Project Not Restored After Restart
- Fixed `App.tsx` to actually use the saved project ID when restoring the active project
  - Previously loaded the `theme` setting but ignored its value, always selecting `projectsList[0]`
  - Now correctly selects the saved project or falls back to first available

#### `permanent_failure` Not Filterable in Runs Screen
- Added missing `permanent_failure` option to `STATUS_OPTIONS` in `src/components/runs/runs-screen.tsx`

#### Settings: No Way to Set Claude Code Path When Not Detected
- Fixed `ClaudeCodeSection` in `src/components/settings/settings-screen.tsx`
  - "Change path" input was only accessible when Claude Code was already found (the toggle button was inside the "detected" branch only)
  - Added "Set path manually" button and install instructions to the "not detected" branch so users can configure the path after onboarding

#### TypeScript: null/undefined Mismatch in Executor
- Fixed `agent/src/executor/index.ts` — `updateRun` call passed `number | null` for `exitCode` and `string | null` for `summary`, but `UpdateRunParams` declares these as `number | undefined` and `string | undefined`
  - Added `?? undefined` coercions to both fields at the call site

### End-to-End Verification — Round 2 Bug Fixes

#### Critical: Goal Creation Sheet Shows Blank Screen When No Clarification Needed
- Fixed `src/components/goals/goal-creation-sheet.tsx`
  - When `assessGoal` returned `needsClarification: false`, the sheet jumped to step 2 but `plan` was still `null`, so `{step === 2 && plan && <PlanReviewStep />}` never rendered — completely blank content area
  - Fix: added `doGeneratePlan()` helper that auto-generates the plan when skipping clarification; step 2 now shows a spinner while generating, an `ErrorBanner` with retry on failure, and `PlanReviewStep` when ready

#### Critical: Once-Jobs Committed via `commitPlan` Never Fire
- Fixed `agent/src/planner/commit.ts`
  - `adjustScheduleConfig` set `fireAt: new Date().toISOString()`, but by the time `createJob` calls `computeNextFireAt(scheduleType, config, new Date())` (a few ms later), `fireAt` is already in the past → `computeNextFireAt` returns `null` → `nextFireAt = null` → scheduler never picks up the job
  - Fix: added `ONCE_FIRE_BUFFER_MS = 10_000` — `fireAt` is now set 10 seconds in the future, ensuring it's still in the future when `createJob` processes it; the job fires on the next scheduler tick (≤ 60s)
  - Added test assertion: `job.nextFireAt` must be non-null for once-jobs created via `commitPlan`

#### Misleading Settings Key for Active Project
- Fixed `App.tsx`: active project ID was stored and read under settings key `"theme"` — renamed to `"active_project"`
  - Added `"active_project"` to `SettingKey` type in `shared/src/index.ts`
  - `"theme"` key retained in the union type for forwards compatibility

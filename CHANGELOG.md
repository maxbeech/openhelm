# Changelog

## [0.1.0] - Unreleased

### Added
- Project scaffold: Tauri 2 + React 18 + TypeScript + Tailwind CSS 4
- Node.js agent sidecar with stdin/stdout IPC
- SQLite database with WAL mode (via better-sqlite3 + Drizzle ORM)
- Shared IPC type contract (`@openorchestra/shared`)
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

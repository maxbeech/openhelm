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

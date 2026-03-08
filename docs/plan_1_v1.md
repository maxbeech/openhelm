# OpenOrchestra v1 — Implementation Plan

**Domain**: OpenOrchestra.ai
**Stack**: Tauri 2 + React 18 + TypeScript + SQLite
**Target**: macOS (arm64 + x86_64), with cross-platform in mind from day one
**Estimated duration**: 7–8 weeks solo, 4–5 weeks with two developers

---

## How to Use This Document

This plan is a sequence of phases, each with a clear goal, detailed implementation guidance for every sub-task, and a completion checklist. No phase should be considered done until every checklist item is verified with real data — not mocked, not assumed.

Phases are ordered by dependency, not complexity. Phase 0 unblocks everything. Phase 3 is the most technically risky and should receive the most time. UI phases (5 onwards) should not begin until the agent is fully stable — a shaky foundation makes UI development dramatically slower and more confusing.

Read the Stack Decisions section before writing any code. Several decisions have nuanced rationale that, if not understood, will lead to the wrong implementation choice at critical moments.

---

## Stack Decisions & Rationale

These decisions are locked for v1. Changing any of them mid-build is expensive both technically and in terms of momentum.

| Concern | Choice | Rationale |
|---|---|---|
| Desktop framework | Tauri 2 | Small binaries (~8MB vs ~150MB for Electron), native OS WebView, strong process management APIs, cross-platform from day one |
| Frontend language | TypeScript + React 18 | Maximum ecosystem depth, hooks model suits real-time streaming, type safety across the UI/agent boundary is essential |
| Styling | Tailwind CSS 4 | Utility-first enables fast iteration, dark mode is trivial, no CSS-in-JS runtime overhead |
| Component library | shadcn/ui | Unstyled primitive components fully owned in the codebase — no version lock-in, no design system imposed |
| Local database | SQLite via better-sqlite3 | Zero-config, file-based, synchronous API suits the agent's sequential execution loop, no Docker or server process required |
| ORM / migrations | Drizzle ORM | TypeScript-native, extremely thin abstraction, generates typed schema from table definitions, handles migrations cleanly |
| Background agent | Node.js sidecar | Keeps all complex logic in TypeScript rather than Rust — more accessible, testable, and maintainable |
| IPC transport | Tauri sidecar stdin/stdout | Simplest possible transport for a single-user local app; JSON lines in, JSON lines out; no sockets, no HTTP, no authentication needed |
| LLM calls | Direct Anthropic SDK | Planning, clarification, and summarisation are completion calls — no third-party agentic framework needed |
| Agentic layer | Custom lightweight implementation | Explicitly not using OpenAI Agents SDK or LangGraph; we build a minimal, transparent agent loop tailored to our specific needs |
| State management | Zustand | Minimal boilerplate, works naturally with real-time event subscription, no provider wrapping |
| Log streaming | Agent event push over IPC | Agent emits log chunks in real time; UI receives them via event bus and appends to a local buffer; no polling |

### The Two Claude Integrations

This is the most important architectural distinction in the entire codebase and must never be blurred.

**Claude Code CLI** is Anthropic's agentic coding tool that users subscribe to. It is invoked as a child process, runs inside the user's project directory, has access to the file system, can run shell commands, and produces rich output. In OpenOrchestra, this is used exclusively for executing jobs — it is the worker. It is never used for planning, summarisation, or any internal system operation.

**Anthropic API** (claude-sonnet-4-5 for planning, claude-haiku-4-5 for summarisation) is used for all internal AI operations: turning a goal into a job plan, generating clarifying questions, and summarising run output into plain English. This requires a separate API key from the user. It is never used to execute jobs.

These two integrations must live in completely separate modules with no shared code paths.

### The Custom Agentic Layer

Rather than adopting a third-party agentic SDK, we build a lightweight, transparent layer in `agent/src/llm/`. The inspiration comes from patterns in the OpenAI Agents SDK JS and similar frameworks, but applied with a much lighter touch: we take the idea of a structured tool-calling loop and implement only the subset we genuinely need, without opinionated abstractions.

The layer has a narrow responsibility: format a message to send to the Anthropic API, handle the response (including any tool calls), and return the result to the calling code. Each call is a discrete, inspectable operation. There is no hidden state, no routing, no memory at the framework level. This keeps the system debuggable and easy to change.

---

## Repository Structure

Understanding the repository structure upfront prevents the instinct to add code in the wrong layer. The core rule: Rust is a thin launcher, the Node agent owns all logic, React owns all presentation.

```
openorchestra/
├── src-tauri/               # Tauri Rust shell — keep as thin as possible
│   ├── src/
│   │   ├── main.rs          # Window setup, sidecar launch, nothing else
│   │   └── lib.rs           # Tauri commands — thin bridge functions only
│   └── Cargo.toml
│
├── src/                     # React frontend — presentation only
│   ├── components/
│   │   ├── ui/              # shadcn/ui primitive components
│   │   ├── layout/          # AppShell, Sidebar, navigation chrome
│   │   ├── goals/           # Goal cards, goal creation sheet, plan review
│   │   ├── jobs/            # Job list, job detail panel, schedule editor
│   │   ├── runs/            # Run list, run detail panel, log viewer
│   │   ├── onboarding/      # Onboarding wizard step components
│   │   └── shared/          # Badges, empty states, status indicators, skeletons
│   ├── hooks/               # Custom React hooks (useRunLogs, useAgentEvent, etc.)
│   ├── stores/              # Zustand stores for client-side state
│   ├── lib/
│   │   ├── api.ts           # Typed wrapper over all IPC calls — the only place frontend calls the agent
│   │   ├── agent-client.ts  # Low-level IPC plumbing (send request, await response)
│   │   └── utils.ts         # Date formatting, string helpers — nothing domain-specific
│   └── App.tsx
│
├── agent/                   # Node.js background agent — all logic lives here
│   ├── src/
│   │   ├── index.ts         # Entry point: initialise everything, start scheduler
│   │   ├── ipc/
│   │   │   ├── server.ts    # Reads stdin, routes to handlers, writes stdout
│   │   │   └── handlers/    # One file per domain: projects, goals, jobs, runs, planner, settings
│   │   ├── db/
│   │   │   ├── schema.ts    # Single source of truth for all table definitions
│   │   │   ├── index.ts     # Database initialisation, WAL mode, foreign keys
│   │   │   └── queries/     # Query functions grouped by domain
│   │   ├── scheduler/
│   │   │   ├── index.ts     # Ticks every minute, enqueues due jobs
│   │   │   ├── queue.ts     # In-memory priority queue for pending runs
│   │   │   └── schedule.ts  # Pure functions for computing next fire times
│   │   ├── executor/
│   │   │   └── index.ts     # Worker pool: dequeues runs, manages process lifecycle
│   │   ├── claude-code/
│   │   │   ├── runner.ts    # ClaudeCodeRunner — the only place that spawns claude
│   │   │   ├── detector.ts  # Auto-detection and version verification
│   │   │   └── interactive-detector.ts  # Detects when Claude Code is waiting for input
│   │   ├── llm/             # Lightweight custom agentic layer
│   │   │   ├── client.ts    # Thin Anthropic SDK wrapper enforcing our conventions
│   │   │   ├── loop.ts      # The agent loop: prompt → response → optional tool call → repeat
│   │   │   └── tools.ts     # Tool definitions available during planning
│   │   └── planner/
│   │       ├── clarifier.ts # Assesses whether a goal needs clarification questions
│   │       ├── generator.ts # Generates job plans from goals
│   │       └── summariser.ts # Produces plain-English run summaries
│   ├── package.json
│   └── tsconfig.json
│
├── shared/
│   └── types.ts             # Types used by both frontend and agent — the contract between layers
│
└── package.json             # Root workspace definition
```

`shared/types.ts` deserves special attention. It is the contract between frontend and agent. Every type that crosses the IPC boundary must be defined here. If a type isn't in `shared/types.ts`, it shouldn't cross the boundary. Treat this file with the same care as a public API.

---

## Phase 0 — Project Bootstrap
**Duration**: 2–3 days
**Goal**: A running Tauri application that launches a React frontend, starts the Node.js sidecar automatically, and initialises the SQLite database. No user-visible functionality yet — just proof that all three layers can talk to each other end-to-end.

This phase sounds simple but frequently takes longer than expected because Tauri's sidecar configuration, Node binary compilation, and macOS code signing requirements interact in non-obvious ways. Budget time accordingly.

---

### 0.1 Development environment prerequisites

Before scaffolding anything, confirm all prerequisites are in place and document the exact versions required in a `CONTRIBUTING.md` file from day one. This saves every future contributor significant setup time.

Required: Node.js 20 LTS or newer, Rust toolchain with both `aarch64-apple-darwin` and `x86_64-apple-darwin` targets installed (both are needed for universal macOS binaries), Xcode Command Line Tools, and the `tauri-cli`. Verify all of these work before writing a single line of code. A missing Rust target is one of the most common sources of confusing build errors that surface much later in the process when a developer assumes the environment is correctly configured.

Also confirm that Claude Code CLI is installed on the development machine. Phase 2 requires running real jobs against a real project directory — without Claude Code locally, integration testing is impossible and the execution logic cannot be verified against real behaviour.

---

### 0.2 Tauri + React scaffold

Use the official Tauri CLI to scaffold the project with the React TypeScript template. Do not create a custom project structure from scratch — the Tauri scaffold sets up important build tool integrations (Vite, the Tauri Vite plugin, and the Rust build system) that are fiddly to replicate correctly.

Once scaffolded, immediately configure the window in `tauri.conf.json`. The app identifier (`ai.openorchestra.app`) must be set from the start — it affects where macOS stores the app's data (`~/Library/Application Support/ai.openorchestra.app/`). Changing the identifier later means all existing users lose their data on upgrade, which is unacceptable. Set the minimum window dimensions to 960×600 immediately and test at this size throughout development. Building to a large screen and testing constraints only at the end leads to expensive UI rework.

Set up the npm workspace in the root `package.json` so that `src/`, `agent/`, and `shared/` can import from each other with clean paths. This is foundational — without it, `shared/types.ts` cannot be imported cleanly from both the frontend and the agent, and the type-safe boundary between layers breaks down.

Verify the scaffold completely before moving on: dev mode should open a window, changes to the frontend should hot-reload without restarting Tauri, and the Rust build should complete cleanly. These are table stakes; if any of them are broken, something in the environment is wrong and must be resolved before proceeding.

---

### 0.3 Node.js sidecar — architecture and compilation

The background agent runs as a Tauri sidecar — a bundled external binary that Tauri starts and monitors alongside the main app. This is the right choice over a pure Rust background service because all complex logic (scheduling, Claude Code process management, Anthropic API calls, database operations) is far more naturally expressed in TypeScript, and the resulting code is easier to test and maintain.

The sidecar communicates with the Tauri frontend via stdin/stdout, exchanging newline-delimited JSON messages. This is the simplest possible IPC mechanism for a single-user local app: no sockets, no HTTP server, no ports, no authentication. The Tauri shell plugin handles all the plumbing.

The compilation step is one of the more complex parts of the build pipeline. The approach for v1 is to use esbuild to bundle the TypeScript agent into a single JavaScript file, then use Node.js's Single Executable Application (SEA) feature to produce a standalone binary. `pkg` is an alternative but bundles an entire Node.js runtime and produces much larger binaries. Node SEA (stable in Node 21+) produces a leaner output.

An important constraint: the sidecar binary name must exactly match the platform-architecture format that Tauri expects (`agent-aarch64-apple-darwin` and `agent-x86_64-apple-darwin`). Tauri is strict about this naming convention and will silently fail to launch the sidecar if the name doesn't match. This should be documented prominently in the build scripts with an explanation of why — it will confuse anyone who encounters it without context.

Verify sidecar launch by having the agent write a startup message to stderr (which appears in Tauri's dev console) and confirming it appears when the app starts in dev mode.

---

### 0.4 Database initialisation and location

The database lives at `~/.openorchestra/openorchestra.db`. This location is chosen deliberately: outside the app bundle (which gets replaced on every update), in a predictable location the user can find and back up, and persisting across app reinstalls. The directory is created by the agent on startup if it doesn't exist.

Database initialisation happens in the agent on every startup. Drizzle runs any pending migrations before the IPC server starts accepting connections. This ordering is critical — it ensures the schema is always current before any requests can be made, eliminating race conditions where the UI requests data before migrations have run.

SQLite must be configured with WAL (Write-Ahead Logging) mode and foreign key enforcement from the very first migration. WAL provides significantly better read performance during concurrent operations — the agent may be writing log chunks while the UI is reading run history — and foreign key enforcement prevents orphaned records from accumulating silently. These two settings should be applied as the first operation on every database connection, not as a migration.

---

### 0.5 IPC protocol design

The IPC protocol is a simple JSON-RPC-inspired system. Two message types flow from UI to agent: requests (which expect a response, identified by a UUID) and fire-and-forget commands. Two types flow from agent to UI: responses (correlated to a request UUID) and events (unprompted pushes like log chunks or run status changes).

The protocol must be strict: unknown methods return a structured error, not silence. Malformed JSON is logged to stderr and ignored rather than crashing the agent. Responses always contain either a `result` or an `error` — never both, never neither. This consistency means any code that receives an IPC response can handle it with a simple, predictable pattern.

The UI-side client maintains a map of pending requests (UUID to promise resolver). When a response arrives, it resolves or rejects the appropriate promise. Events are dispatched as `CustomEvent` objects on `window`, allowing any React component to subscribe to any event type through a simple hook without prop drilling or context providers.

Implement and verify a single test IPC call (ping → pong) before Phase 1 begins. This smoke test confirms the entire sidecar communication chain is working before any real functionality is added on top of it.

---

### Phase 0 Completion Checklist
- [ ] `npm run tauri dev` opens a window on both arm64 and x86_64 Macs
- [ ] Hot reload works from `src/` without restarting Tauri
- [ ] The Node.js sidecar launches automatically and logs its startup message to the Tauri console
- [ ] The SQLite database file is created at `~/.openorchestra/openorchestra.db` on first launch
- [ ] Schema tables are created correctly
- [ ] A test IPC ping/pong round-trip works and resolves the promise correctly
- [ ] The workspace allows importing from `shared/` in both `src/` and `agent/` with no TypeScript errors
- [ ] Both arm64 and x86_64 production builds compile without errors or warnings

---

## Phase 1 — Data Layer & Core CRUD
**Duration**: 3–4 days
**Goal**: Every database operation the application needs is implemented in the agent, tested in isolation, and accessible via typed IPC calls from the frontend. No application UI is built in this phase.

The discipline of building and fully verifying the data layer before building UI pays off enormously. UI development on top of an uncertain data layer produces debugging sessions where it is genuinely unclear whether a bug is in the UI or the data — one of the most time-consuming situations in development.

---

### 1.1 Schema design

The schema is the most consequential design decision in Phase 1. It must accurately reflect the product's conceptual hierarchy (Projects → Goals → Jobs → Runs) without over-engineering for v2 or v3 features. The schema defined here will need to survive without breaking migrations for the lifetime of v1 users' data.

**Projects** are the top-level container. A project represents a local directory on the user's machine that Claude Code will work within. It stores a name, optional description, and `directoryPath`. The path is validated on creation.

**Goals** belong to a project and represent high-level outcomes. A goal stores the user's original description as free text, a status field (`active`, `paused`, `archived`), and a foreign key to its project. Archiving a goal should disable all its associated jobs. Deleting a goal cascade-deletes its jobs and their run history.

**Jobs** belong to a project and optionally to a goal. The optional goal association matters: manually created jobs (Phase 7) may not belong to any goal, and this is a valid, first-class concept. A job stores the raw prompt that will be sent to Claude Code, the schedule type, a `scheduleConfig` JSON blob (whose structure varies by schedule type), a boolean `isEnabled`, and `nextFireAt` — the timestamp of the next scheduled execution. Storing `nextFireAt` as a denormalised column rather than computing it on the fly makes the scheduler query trivially simple and fast.

**Runs** belong to a job and represent a single execution. They transition through a defined state machine: `queued → running → succeeded | failed | permanent_failure | cancelled`. The distinction between `failed` and `permanent_failure` is a v2 concept but the column should exist from day one: `failed` means the issue may be transient or automatically fixable, while `permanent_failure` means human intervention is required. In v1 all failures are `failed`. The `triggerSource` field records how the run was initiated (`scheduled`, `manual`, or `corrective` for v2).

**RunLogs** belong to a run and store Claude Code's output in chunks captured in real time. Each chunk carries a monotonically increasing sequence number within its run, a stream designation (`stdout` or `stderr`), the text content, and a timestamp. The sequence number is critical for the log viewer to display lines in correct order even if chunks arrive slightly out of sequence over IPC.

**Settings** is a key-value store for application configuration. Using a database table rather than a config file means settings are queryable from the same connection as all other data, and there is no risk of file permission issues on macOS sandboxed environments. All valid setting keys should be defined as a TypeScript union type to prevent typos causing silent failures.

---

### 1.2 Query layer design

Every database operation is a named function in `agent/src/db/queries/`, grouped by entity. There are no raw SQL or Drizzle query builder calls outside these files. This means when a query needs to change — for a performance optimisation, an added field, or a bug fix — there is exactly one place to find and update it.

Each query function has a single, clear responsibility. A function that updates a job's enabled status does only that — it does not also recalculate `nextFireAt`. This granularity makes the scheduler and executor code readable, and it makes writing focused unit tests straightforward.

Error handling in query functions is consistent: database errors bubble up as typed errors that the IPC handler catches and translates into structured error responses. Query functions never swallow errors silently or return null to represent "an error occurred" — they either return a result or throw.

The settings queries should be implemented first in this phase, since detecting Claude Code (Phase 2) and verifying the API key (onboarding, Phase 5) both depend on them.

---

### 1.3 IPC handler layer

The IPC handler layer sits between the query layer and the raw IPC server. Each domain (projects, goals, jobs, runs, settings) has its own handler file that registers method names and maps them to the appropriate query functions.

Handler functions are responsible for: validating that required fields are present and of the correct type, calling into the query layer, and shaping the response for the UI. They must not contain business logic — if a handler is doing more than validating, querying, and returning, that logic probably belongs in the scheduler, executor, or planner instead.

Error messages from handlers should be written for a developer reading them in a debug context, not for display directly in the UI. The frontend is responsible for translating structured errors into user-facing messages. This separation prevents technical error strings from leaking into the UI and means error messages can be improved on either side independently.

---

### 1.4 Typed frontend API

The frontend never calls the IPC layer directly. Every call goes through `src/lib/api.ts`, which is a fully typed wrapper exposing every agent capability as a named async function. This provides two benefits: TypeScript will catch incorrect parameter shapes at compile time, and there is a single place to add cross-cutting concerns like request logging or error normalisation in the future.

All types in `api.ts` must be derived from `shared/types.ts`. If a type needs to exist in `api.ts` that isn't yet in `shared/types.ts`, add it to `shared/types.ts` first. This discipline enforces the contract between layers.

---

### 1.5 Test coverage for the data layer

This phase introduces most of the application's data logic and should be fully covered by unit tests before any further phases begin. Tests in the agent use a real SQLite database created fresh in a temporary directory for each test run — not mocks. This is essential because SQLite's behaviour (foreign key cascades, WAL mode, constraint enforcement, transaction isolation) is part of what's being tested. Mocking the database would miss an entire class of bugs.

Test coverage must include: creating and retrieving every entity type, cascade deletes propagating correctly through the hierarchy, the settings key-value system persisting correctly, `nextFireAt` being calculated correctly for all three schedule types, and query functions throwing correctly on invalid inputs (missing required fields, references to non-existent foreign keys, invalid status transitions).

---

### Phase 1 Completion Checklist
- [x] All five entities (Project, Goal, Job, Run, RunLog) can be created, read, updated, and deleted via IPC
- [x] Cascade deletes work correctly through the full hierarchy (deleting a Project removes everything beneath it)
- [x] Settings persist across agent restarts
- [x] `nextFireAt` is calculated correctly for once, interval, and cron schedule types
- [x] Invalid cron expressions are rejected with a clear, structured error at create time
- [x] All query functions are covered by unit tests and all tests pass (70 tests across 7 files)
- [x] A temporary debug panel in the UI can list projects from the real database
- [x] No TypeScript errors in `shared/types.ts`, `agent/`, or `src/lib/api.ts`

---

## Phase 2 — Claude Code Integration
**Duration**: 3–4 days
**Goal**: The application can locate the Claude Code CLI, verify it works, spawn it against a project directory with a given prompt, stream its output in real time to the database and the UI, and correctly determine success or failure.

This is the highest-risk phase in v1. Everything downstream depends on this being completely solid. Budget more time here than the estimate suggests if anything is unclear about the Claude Code CLI's behaviour.

---

### 2.1 The ClaudeCodeRunner principle

`ClaudeCodeRunner` in `agent/src/claude-code/runner.ts` is the only place in the entire codebase that spawns the `claude` process. This is not a convention — it is a hard architectural rule enforced by code review.

The reason for this strictness is version compatibility. Anthropic updates the Claude Code CLI frequently. If invocations are scattered across the codebase, a CLI change requires finding and updating multiple places, with a high risk of missing one. With a single runner module, there is exactly one file to update when the CLI changes, and a single set of tests to verify the fix works.

The runner's public interface should be narrow: accept a configuration object (binary path, working directory, prompt, timeout, log callback) and return a promise resolving to the exit code and a timeout flag. All interaction with the actual process — argument construction, output streaming, timeout management, process cleanup — is fully encapsulated within the runner.

Before writing any argument construction code, run `claude --help` and read the actual current flag documentation. Do not assume knowledge of the flags from memory or from earlier versions of this plan — the CLI changes and assumptions will break.

---

### 2.2 Invocation strategy and headless mode

Claude Code must run in non-interactive (headless) mode for scheduled jobs to function. Without headless mode, Claude Code may pause mid-execution waiting for confirmation, leaving the job hanging indefinitely. Verify the current flag for headless mode from the live `--help` output before implementing.

The working directory for the spawned process must be set to the project's `directoryPath`. Claude Code's file system operations are relative to the working directory, so getting this wrong would cause jobs to operate on the wrong directory — a potentially destructive mistake.

The spawned process should inherit the parent process's full environment rather than receiving a cleaned environment. Claude Code reads its configuration, authentication credentials, and any project-level `.env` files from the environment. A cleaned environment would break authentication silently and in a way that produces confusing error messages in the run logs.

---

### 2.3 Output streaming design

Claude Code can run for 5, 10, or 30 minutes for complex tasks. The UI must show live progress throughout — not just a spinner followed by the final output. This requires streaming output from the Claude Code process simultaneously to the database and the UI, in real time, as the process runs.

The streaming has three layers that operate concurrently: the process pipe (Node.js `child_process` stdout/stderr pipes), the database writer (inserting `RunLog` rows continuously), and the IPC emitter (pushing log chunks to the UI via the event bus). All three must happen in parallel — buffering the entire output in memory before inserting would fail for long-running jobs and would prevent live progress in the UI.

Buffer output in complete lines (splitting on newline characters) so that sequence numbers align with meaningful units of output. The sequence number on each `RunLog` row must be monotonically increasing within a run — gaps or duplicates here will cause the log viewer to display content in the wrong order.

The ordering invariant is important: insert the log row into the database before emitting the IPC event. If the UI receives an event before the database has written the corresponding row, and the user then reloads the run detail, it would appear to have fewer lines than were shown live. Maintaining insert-then-emit ordering guarantees consistency between live view and historical view.

---

### 2.4 CLI detection and version management

Auto-detection should check common install locations in a defined priority order: the system `PATH` (via `which`), Homebrew locations, and common npm global install directories. The first working binary found wins. The detection logic should be readable as a list of locations and the rationale for checking each, so that when new install methods appear they can be added easily.

Version detection reads the output of `claude --version` and parses the semantic version string. The runner stores a `MIN_CLI_VERSION` constant that is checked on detection. If the installed version is below the minimum, the UI shows a warning with upgrade instructions rather than silently using a potentially incompatible version. The minimum version should be the version tested against during development of this phase.

Detection results (path and version) are stored in the settings table after a successful detection. On subsequent startups, the agent verifies the stored path still exists and responds to `--version` before proceeding. If it doesn't (Claude Code may have been updated or moved), the agent re-runs auto-detection and updates the stored path automatically.

---

### 2.5 Interactive prompt detection

Claude Code occasionally pauses mid-run to ask the user a question — requesting credentials, asking for confirmation before a destructive action, or seeking clarification. In a scheduled, unattended context this is a critical failure mode: the process hangs indefinitely, consuming a worker slot, while the user has no indication of why their job isn't progressing.

The interactive detector monitors two signals simultaneously. The first is output content: a rolling buffer of recent output checked against patterns that suggest a question is being asked, such as lines ending with a question mark, `(y/n)` choice prompts, or phrases like "press enter to continue". The second is output silence: 60 seconds of no output from an otherwise active process is a strong signal that the process is waiting.

When interactive behaviour is detected, the run must not be killed. The correct response is to hold the run in a `waiting_for_input` status, notify the UI, and let the user decide whether to cancel. Killing the run would discard any work Claude Code had already done. In v1, this surfaces as a status banner on the run detail screen. In v2, it escalates to the inbox system.

---

### 2.6 Integration testing

The integration tests for this phase are the most important tests in the project, and they must run against a real Claude Code installation with real credentials. Do not mock the Claude Code CLI in these tests — the entire point is to verify the integration works against actual behaviour, including edge cases that would never appear in a mocked environment.

Set up a small dedicated test project directory containing a few simple, known files. Write integration tests covering: spawning Claude Code with a benign, deterministic prompt ("list all TypeScript files in this directory and count them"), verifying the exit code is 0, verifying log chunks were captured in the database, verifying the output contains expected content, verifying the timeout fires correctly (use a prompt designed to take a long time, with a short timeout in the test), and verifying the process is killed cleanly when cancelled.

These tests require API credentials and make real API calls. Tag them so they run separately from the unit test suite, which must remain fast and offline.

---

### Phase 2 Completion Checklist
- [x] Auto-detection finds the Claude Code binary on a standard macOS installation
- [x] Manual path entry and re-verification work correctly
- [x] Version detection correctly identifies the version and compares against the minimum requirement
- [x] A real Claude Code job runs against a real project directory and output is captured in the database
- [x] Log chunks appear in the database during the run, not only after the process exits
- [x] Chunks are numbered sequentially and correctly distinguish stdout from stderr
- [x] Exit code 0 is captured for a successful run, non-zero for a failure
- [x] The timeout fires correctly and the process is killed with SIGTERM, then SIGKILL if still running after 5 seconds
- [x] Interactive prompt detection triggers within 60 seconds of output silence
- [x] The runner emits the correct IPC events at each lifecycle stage (started, log chunk, status change, completed)
- [x] All unit and integration tests pass (112 tests across 11 files)

---

## Phase 3 — Scheduler & Executor
**Duration**: 4–5 days
**Goal**: Jobs fire at the correct scheduled time without the UI being open. The executor manages concurrent runs without conflict. Run status transitions through the state machine correctly. The system recovers from unexpected agent shutdowns without losing run state.

This phase contains the most systems-programming-like thinking in the project. The scheduler and executor are not individually difficult to implement, but their interaction — particularly crash recovery and the queued-to-running transition — requires careful design upfront.

---

### 3.1 The scheduler's responsibilities

The scheduler has one job: once per minute, query the database for any enabled jobs whose `nextFireAt` is in the past, create run records for them, add them to the execution queue, and update their `nextFireAt` to the next future time. That is the complete scope of the scheduler's responsibility.

The scheduler does not execute jobs, manage processes, interact with Claude Code, or do anything other than the above. This strict separation means the scheduler can be tested in complete isolation from the executor — a scheduler test creates jobs with past `nextFireAt` values, triggers a tick, and verifies the run records created in the database. No processes are spawned.

The one-minute tick interval is deliberate. It is fast enough for practical use (a job set to run "now" will start within one minute) and slow enough that the scheduling overhead is negligible. A shorter interval adds CPU wake-ups with no meaningful user benefit.

Timezone handling deserves explicit attention. `nextFireAt` is stored as a Unix timestamp in the database. All comparisons are in UTC. The schedule configuration stores the user's intended timezone separately, and `computeNextFireAt` uses this when computing the next occurrence for cron and daily schedules. Ignoring timezone is one of the most common scheduling bugs and causes jobs to fire at wrong local times during DST transitions.

---

### 3.2 The job queue and crash recovery

The in-memory job queue is a priority queue that allows manually-triggered runs to take precedence over scheduled ones. Priority is a simple integer: 0 for manual, 1 for scheduled, 2 for corrective (v2). When the user clicks "Run now", the resulting run starts immediately rather than waiting behind scheduled work.

The queue is in-memory but backed by the database for crash recovery. On agent startup, the agent queries for any runs with `status = queued` and reloads them into the in-memory queue. Tauri restarts sidecars automatically and quickly after a crash, so this recovery typically completes within seconds.

Runs that were in `status = running` when the agent died cannot be resumed — the process is gone. On startup, the agent scans for runs stuck in `running` status and transitions them to `failed`, adding a note in the logs explaining that they were interrupted by an agent restart. This is honest and correct behaviour. Do not attempt to detect or resume partially completed runs — the complexity is not worth it and the result would be unpredictable.

---

### 3.3 Executor design and the concurrency decision

The executor consumes from the queue and manages the Claude Code process lifecycle for each run. The default concurrency is 1 — one active run at a time. This is the correct default for v1 because: Claude Code uses significant system resources during a run; two concurrent Claude Code processes operating on the same project directory could cause file conflicts; and the single-run mental model is simpler for users to reason about.

Concurrency up to 3 is configurable in settings, but the default and the recommended value is 1. The UI should make this clear with explanatory text next to the setting.

The executor's core sequence for each run is: dequeue a run → load the associated job to get prompt, working directory, and project → mark the run as `running` in the database → emit a `run.statusChanged` IPC event → invoke `ClaudeCodeRunner` → on completion, mark the run as `succeeded` or `failed` → update the job's `nextFireAt` → attempt to dequeue the next run.

The ordering of database write before process start is an important invariant: the run must be marked `running` in the database before the Claude Code process is spawned. If the agent crashes after spawning but before updating the database, the process would run in the background with no corresponding database record, and the run would be re-queued incorrectly on the next startup. The database write before spawn eliminates this class of bug.

---

### 3.4 Run status state machine

The run status is a finite state machine. Enforcing valid transitions at the application layer (in the query functions) prevents bugs where a run ends up in an impossible state that the UI doesn't know how to display.

Valid transitions: `queued → running`, `queued → cancelled`, `running → succeeded`, `running → failed`, `running → cancelled`, `running → permanent_failure`. Any attempt to transition from a terminal state (succeeded, failed, permanent_failure, cancelled) to any other state should be treated as a bug and logged as an error, not silently ignored.

The `permanent_failure` status is used when a pre-flight check fails — for example, the Claude Code binary is missing, the project directory no longer exists, or the settings are in an invalid state. These failures cannot be resolved by retrying the job as-is; the user must take action first. In v1, these surface as a special badge in the runs list. In v2, they escalate to the inbox system.

---

### 3.5 Next fire time computation

When a scheduled run completes (regardless of outcome), the job's `nextFireAt` must be updated immediately as part of the same operation that marks the run complete. If this update is delayed, the scheduler may fire the job again on its next tick.

For `once` jobs: there is no next fire time — the job disables itself after its first run. Set `isEnabled` to false and null out `nextFireAt`.

For `interval` jobs: the next fire time is `completedAt + intervalMinutes`. Using completion time rather than the originally-scheduled fire time prevents drift accumulation (where a slow job gradually shifts its schedule) while also preventing the backlog scenario (where a delayed job would immediately re-fire multiple times trying to catch up).

For `cron` jobs: the next fire time is the first future time matching the cron expression, computed from the current time in the user's configured timezone. The computed time must be verified to be actually in the future — a malformed cron expression can produce past times, which would cause an immediate re-fire loop. If the computed time is not in the future, fail loudly rather than silently correcting.

---

### 3.6 Testing the scheduler and executor

Scheduler tests should cover: jobs with past `nextFireAt` are enqueued correctly, jobs with future times are not, disabled jobs are never enqueued regardless of their `nextFireAt`, `nextFireAt` is updated correctly for all three schedule types after a run, one-off jobs are disabled after their first run, and cron computation handles timezone-aware scheduling correctly.

Executor tests require a mock `ClaudeCodeRunner` that returns controlled outcomes (success, failure, timeout) so the state machine can be tested without real processes. Tests should cover: the full state machine (queued through all terminal states), cancellation at both the queued and running stages, crash recovery (runs in `running` status at startup are transitioned to `failed`), and correct sequencing of database writes before IPC events.

The 24-hour stability test at the end of this phase is critical and should not be skipped. Run 5 jobs on short intervals (every 5 minutes) for 24 hours and monitor memory usage and database size. Memory should remain stable. Any growth indicates a leak in the log buffering, the IPC event subscription, or the in-memory queue.

---

### Phase 3 Completion Checklist
- [x] A job created with a 2-minute interval fires within 2 minutes without the UI open
- [x] Manual trigger via IPC fires within seconds and takes priority over queued scheduled runs
- [x] Status transitions follow the state machine exactly — no invalid transitions occur
- [x] Cancelling a queued run removes it from the in-memory queue and sets database status to `cancelled`
- [x] Cancelling a running run kills the Claude Code process and sets status to `cancelled`
- [x] Runs in `running` status at agent startup are transitioned to `failed` with an explanatory log entry
- [x] Queued runs at agent startup are re-enqueued and execute correctly
- [x] The watchdog kills a hung process after the configured timeout and marks it `failed`
- [x] `nextFireAt` is updated correctly for all three schedule types after each run
- [x] All scheduler and executor unit tests pass
- [ ] 24-hour stability test with 5 recurring jobs shows stable memory usage

---

## Phase 4 — LLM Layer & AI Planning
**Duration**: 3–4 days
**Goal**: Given a goal description and project context, the system produces a sensible, reviewable job plan. Vague goals trigger targeted clarifying questions. The custom LLM layer is clean, minimal, and clearly separated from the rest of the agent.

---

### 4.1 The custom LLM layer design

The LLM layer in `agent/src/llm/` is the only code that calls the Anthropic SDK directly. It has three components with clearly separated concerns.

`client.ts` is a thin wrapper around the Anthropic SDK that enforces OpenOrchestra's conventions: it reads the API key from the settings table (not environment variables, since this is a user-configured value not a deployment secret), uses consistent model names, sets appropriate timeouts, and converts SDK errors into the application's own typed error hierarchy. Nothing outside `client.ts` imports from `@anthropic-ai/sdk` directly. This means if the SDK's interface changes, there is exactly one file to update — the same principle as `ClaudeCodeRunner` for the CLI.

Before hardcoding any model strings, verify the current model names via the Anthropic documentation or API. Model names change, and using a deprecated model name silently falls back to a different model or fails outright.

`loop.ts` implements the agent loop for calls that may involve tool use. The loop is intentionally minimal: send a message to the API, inspect the response, and if it contains tool calls execute them and send results back. Repeat until the response is a final text answer, or until the maximum number of iterations is reached. The maximum iterations limit is a safety mechanism — without it, a malfunctioning model or tool could loop indefinitely. For the planning use case, three iterations is sufficient; the limit should be configurable per call.

`tools.ts` defines the tool schemas available to the model during planning. For v1, this is a minimal set: `validate_cron_expression` (checks that a cron string is parseable and returns the next three occurrences in human-readable form) and `get_current_datetime` (returns the current date and time in the user's timezone, used for generating appropriately-timed schedules). The tool set is small by design — every tool added is a thing that can malfunction, and the planning use case doesn't require a large tool set.

---

### 4.2 Prompt clarity assessment

Before generating a plan, the system assesses whether the user's goal is specific enough to plan against effectively. This is a single, fast classification call — not the full agent loop. The model reads the goal and the project description and returns a structured response: either "no clarification needed" or "here are 1–2 questions that would improve the plan."

The assessment must err strongly on the side of not asking questions. Every question adds friction and delays the user from seeing the plan they're excited about. A question should only appear when the missing information would genuinely lead to a meaningfully different or better plan. A goal that's somewhat vague but has an obvious interpretation should proceed to planning, not to interrogation.

The maximum number of clarification questions is two, and this limit should be hardcoded, not configurable. More than two questions transforms the experience from a conversational clarification into filling out a form, which undermines the product's promise of a simple goal input.

Questions should present multiple-choice options (generated dynamically by the model based on the specific goal, not hardcoded) alongside a free-text "Something else" option. The options serve as suggested answers that reduce the cognitive work of responding, but the user is never forced to choose from them.

---

### 4.3 Job plan generation

The plan generation call is the centrepiece of the product. The quality of output here directly determines whether users trust the system enough to approve and run plans. Time invested in the planning prompt pays dividends across the entire product.

The system prompt must establish clearly: the role of the model in this context (planning automated background tasks, not executing them), what Claude Code is and what it can do in a project directory, the expected output format (structured JSON that can be parsed reliably), the constraints on plans (2–6 jobs, mix of one-off and recurring, each prompt must be fully self-contained), and the characteristics of a good job prompt versus a poor one.

The self-contained prompt requirement deserves special emphasis in the system prompt. Claude Code has no memory between runs. A job prompt that references "what you found last week" or "the issues from the previous run" will produce nonsensical output. Every prompt must establish its own context, state what it needs to do, and be interpretable by Claude Code in complete isolation.

Each job in the generated plan must include a `rationale` field explaining in one sentence why this job is part of the plan. This serves two purposes: it helps users understand and evaluate the plan before approving it, and it acts as an implicit quality signal — a rationale that doesn't make sense is a reliable indicator that the job itself may not be useful.

The plan should always include a mix of one-off and recurring jobs. One-off jobs handle immediate analysis, setup, or actions that don't need to repeat. Recurring jobs handle ongoing maintenance, monitoring, or regular tasks. A plan consisting entirely of one-off jobs or entirely of recurring jobs is usually a sign the model didn't interpret the goal correctly.

---

### 4.4 Plan commitment

The commit operation writes the user's approved (and potentially edited) plan to the database as a new goal and a set of jobs, within a single database transaction. All jobs are created or none are — partial commits are not acceptable.

For once-jobs, `nextFireAt` should be set to the current time so the scheduler picks them up on its next tick. The UI should communicate this clearly: "This job will start within a minute." Do not tell users a job will start "immediately" because the scheduler's one-minute tick means there is always a brief delay.

For recurring jobs, `nextFireAt` is computed forward from the current time. A cron job running "every Monday at 9am" committed on Tuesday should have its first fire time set to the following Monday, not to the past Monday. Verify the timezone calculation handles this edge case correctly — it is one of the most common bugs in scheduling systems.

---

### 4.5 Testing the LLM layer

LLM calls cannot be meaningfully unit tested without either mocking or making real API calls. The testing strategy is: unit tests for the `client.ts` wrapper (verify request formatting and error handling using mocked HTTP responses), unit tests for the `loop.ts` logic (verify the tool-calling loop terminates correctly under various response shapes, using mocked client calls), and integration tests for the planner functions (verify structural constraints on the output using real API calls).

The integration tests for planning should not assert on specific job names or descriptions — those will vary. Instead, assert on structural properties: the number of jobs is between 2 and 6, every job has a non-empty name, description, prompt, and rationale, schedule types are from the valid set, and cron expressions are parseable. These structural tests catch regressions in the planning prompt without being brittle to normal variation in LLM output.

---

### Phase 4 Completion Checklist
- [x] A vague goal triggers 1–2 clarification questions; a specific goal skips directly to generation
- [x] No more than 2 clarification questions are ever generated
- [x] Generated plans contain 2–6 jobs
- [x] Every job has a non-empty name, description, prompt, schedule config, and rationale
- [x] Plans typically contain a mix of one-off and recurring jobs (prompted in system prompt)
- [x] `nextFireAt` for once-jobs is set to the current time
- [x] `nextFireAt` for recurring jobs is set to the correct first future occurrence in the user's timezone
- [x] Committing a plan creates the goal and all jobs atomically (either all or nothing)
- [x] A committed once-job fires within one scheduler tick
- [x] LLM client unit tests pass, including error and timeout cases
- [ ] Planning integration tests pass with real API credentials (requires API key at runtime)

---

## Phase 5 — Core UI
**Duration**: 5–6 days
**Goal**: A fully functional desktop application with every screen a v1 user will encounter. All screens show real data. Every user flow from onboarding through running a first job to inspecting run logs works correctly.

This is the longest phase in terms of files created, but it builds on a solid foundation. With the data layer, executor, and planning API all verified, this phase is primarily a React implementation exercise with clear contracts already defined.

---

### 5.1 Design system and visual language

OpenOrchestra is a tool for technical founders who are trusting it to run autonomous tasks on their codebases. The visual language must communicate reliability, precision, and professional calm. Every design decision should reinforce that the user is in control and that the system is behaving predictably.

Dark mode is the default and primary mode. The colour palette is built on deep navy as the dominant surface colour, with warm amber as the single accent. Amber is used purposefully and sparingly: primary call-to-action buttons, active and running state indicators, decorative header elements. Green signals success exclusively, red signals failure exclusively, amber signals running or attention-needed. No colour in the palette should be used decoratively in a way that could be confused with a status signal — this would erode the user's ability to scan status quickly.

Typography should feel precise and developer-appropriate. Log output in the log viewer should use the system's default monospace font with `font-variant-numeric: tabular-nums` so timestamps and line counts align correctly. All other text uses a clean, modern sans-serif at defined scale steps.

All interactive elements must have explicit hover and focus states. The application will be used by people who navigate with keyboards. Test tab order on every screen, not just once at the end.

shadcn/ui provides the primitive components. All design tokens are defined as CSS variables in `globals.css` and applied through Tailwind. Never use inline styles for design decisions — they bypass the design system and make future changes unnecessarily difficult.

---

### 5.2 Application shell and navigation

The shell is the persistent layout wrapping every screen: a fixed left sidebar and a main content area. The sidebar structure never changes regardless of what is displayed in the main area.

The sidebar's top section contains the project selector — a dropdown showing all projects with the active project selected and a "New project" option at the bottom. Switching projects updates every screen immediately and without a full reload. The active project selection is stored in Zustand and persisted in settings across sessions.

The sidebar navigation has four items: Goals, Jobs, Runs, and Settings. Each carries a status indicator: Goals shows active goal count, Jobs shows enabled job count, Runs shows a live-updating count of currently-running runs with a subtle pulse animation when non-zero. The pulse is the only animation in the navigation — it serves as a peripheral awareness signal that something is happening, without being distracting.

The navigation is intentionally flat. There is no nested navigation in v1. Every feature is one click from the sidebar. This simplicity is correct for a product where the user is still developing their mental model of how Projects, Goals, Jobs, and Runs relate to each other.

---

### 5.3 Onboarding wizard

The onboarding wizard gates the entire application — the main shell is not shown until onboarding is complete. A user who skips setup and lands on an empty dashboard is more disoriented than one who is guided through setup before seeing anything. The gate is the right call.

**Step 1: Welcome.** Full screen, centred, minimal. The OpenOrchestra wordmark, one sentence describing the product, and a single "Let's get started" button. No bullet points, no feature lists, no screenshots. The purpose of this step is to create a calm, trustworthy first impression before asking anything of the user.

**Step 2: Claude Code detection.** Auto-detection runs in the background as this step loads. In most cases, detection completes before the user has finished reading the screen. If found: show the detected path and version with a green checkmark. If not found: show the current installation instructions (check the actual Claude Code documentation for the install command before writing this screen — it changes), a "I've installed it — check again" button, and a "Set path manually" option that reveals a text input. Never show a generic "Claude Code not found" error with no guidance.

**Step 3: Anthropic API key.** Explain in plain English why a separate API key is needed — it's used for planning goals and summarising run results, separate from their Claude Code subscription. Include a direct link to console.anthropic.com. The key input should mask the value after entry. A "Test key" button makes a minimal real API call to verify the key works before proceeding. On failure, show the error message from the API in human-readable form — most key errors are clearly described by the API response.

**Step 4: First project.** Name (required), directory (required, native file picker), optional description. The description field should have a placeholder explaining its purpose: "Describe your project — this helps generate better job plans." Show a validation error if the directory doesn't exist, rather than allowing a project to be created with an invalid path.

**Step 5: Complete.** "You're all set." One sentence. A single "Create your first goal" button that closes the wizard and immediately opens the goal creation sheet. Do not drop the user on an empty Goals screen — bring them directly into the creation flow while the context and motivation are fresh.

---

### 5.4 Goals screen and the goal creation entry point

The Goals screen is the home screen. Its two jobs are: show the status of existing goals clearly, and make creating a new goal effortless.

The goal input lives at the top of the screen at all times — not hidden behind a "New goal" button. A large, inviting text field with a placeholder ("What do you want to achieve?") and three clickable example chips below it that pre-fill the input on click. The visual treatment should make this feel like the natural starting point for interacting with the app.

Below the input, goal cards are shown in a responsive grid. Each card displays: goal title (truncated at two lines), status badge (active/paused/archived), job count, most recent run status with relative time, and time until next scheduled run. Cards for goals with currently-running jobs show a subtle animated border — the pulse animation communicating activity without demanding attention.

Clicking a goal card navigates to the Jobs screen filtered to that goal, not to a separate goal detail screen. In v1, goals don't have enough dedicated content to justify their own screen. The filtering on the Jobs screen provides sufficient goal-scoped context.

---

### 5.5 Goal creation sheet

The goal creation sheet is a right-side slide-over panel and the most important UI in the application. Every design decision here should be made with the question: "Does this make the user more confident in what they're about to run?"

The sheet has a fixed header showing the current step name and a linear progress indicator. The content scrolls if needed. The primary action button is always in the footer, visually separated from the scrollable content.

**Step 1: Goal input.** The goal text is shown prominently (pre-filled if the user typed in the home screen input). A project selector if the user has multiple projects. A "Continue" button that triggers the clarification assessment. While the assessment API call runs, show a brief loading state with a message like "Reviewing your goal..." that communicates something is happening without overpromising.

**Step 2: Clarification (conditional).** Only rendered if the assessment returned questions. Questions are displayed with multiple-choice options as large, clickable radio chips — not a dropdown. A "Something else" option at the bottom of each question reveals a text field. The "Generate plan" button stays disabled until all questions have a selection or text answer.

**Step 3: Plan review.** Each job in the generated plan is a card with: job name (prominent), description (2–3 plain-English sentences), schedule in human-readable form ("Runs once immediately", "Every Monday at 9:00 AM", "Every 6 hours"), and rationale in a smaller, muted style. Each card has an edit icon (opens an inline editor for name, prompt, and schedule) and a delete icon. An "Add another job" link at the bottom opens a simple inline job form.

A summary banner above the job list: "This plan will create 4 jobs — 1 starts immediately, 3 run on a schedule." The "Approve and start" button in the footer should be clearly labelled with its consequence. The user should never feel surprised by what clicking this button does.

**Step 4: Confirmation.** "Your plan is running." The goal is created, the jobs are in the database, and the first once-job is queued. Brief description: "The first job has started. You can track its progress in the Runs screen." A "View runs" link and a close button.

---

### 5.6 Jobs screen

The Jobs screen shows all jobs for the active project. The default view shows only enabled jobs; a toggle in the filter bar reveals disabled jobs. A goal filter dropdown allows scoping the list to a single goal's jobs.

The list is a table with columns: job name, goal association (chip, clickable to filter by that goal), schedule (human-readable), enabled toggle, last run status with relative time, and next scheduled time. The enabled toggle acts immediately — toggling it off disables the job and clears `nextFireAt`; toggling it on re-enables and recalculates `nextFireAt`.

Clicking a job name opens a detail panel on the right side of the screen. Using a panel rather than navigating to a new screen keeps the list visible, which is important when the user is comparing jobs or checking context. The panel can be dismissed by clicking outside it or pressing Escape.

The job detail panel shows: the full job description, the complete prompt in a code-style block (expandable, so long prompts don't dominate the panel), the schedule configuration with a pencil icon to edit inline, the enabled/disabled toggle, a "Run now" button, and a run history timeline showing the last 20 runs with their status icons and relative times. Clicking any run in the history timeline opens that run in the Runs screen.

The "Run now" button shows a brief confirmation if a run for this job is already in progress: "This job is already running. Start another run?" Concurrent runs of the same job are technically permitted but unusual and potentially risky.

---

### 5.7 Runs screen and log viewer

The Runs screen shows all runs for the active project, sorted by most recent. It can be filtered by job and by status. Runs for jobs that have since been deleted are shown with a "Deleted job" label rather than being hidden — the run history has value even when the originating job is gone.

Each run row shows: a status icon (animated pulse for running, static for terminal states), the job name, trigger source (Scheduled / Manual), start time and duration, and the first line of the AI summary once available. Clicking a row opens the run detail panel.

The run detail panel has two sections: a status banner and the log viewer.

The status banner is full-width and changes appearance completely based on status. Running: amber background with elapsed time that updates every second, and a Cancel button. Succeeded: green background, "Succeeded", total duration. Failed: red background, "Failed", exit code, total duration. The banner communicates the most important information at a glance and makes it impossible to misread the outcome.

The log viewer is the most technically demanding component in the application. It must handle thousands of lines without performance degradation, display stdout and stderr in different colours, auto-scroll to the bottom during live runs, stay at the user's scroll position when they manually scroll up, show a "Jump to latest" button when the user has scrolled up during a live run, and support search with highlight.

The performance strategy for the log viewer: incoming log chunks from the event bus are buffered in a React `useRef` (which does not trigger re-renders) and flushed to displayable state on a 100ms interval. This batches many incoming chunks into a single React re-render, keeping the viewer smooth even during Claude Code's fastest output bursts.

The AI summary appears above the log viewer as a distinct block with a clear label. For running jobs, show a placeholder message. For completed jobs where summarisation failed, show "Summary unavailable" rather than crashing or hiding the block.

---

### 5.8 Real-time state management

The Zustand stores for runs and run logs must be designed to handle real-time updates from the agent's event stream without performance degradation or stale state.

Run status updates from `agent:run.statusChanged` events update the relevant run record directly in the store. Any component subscribed to that run's status automatically re-renders with the new state. No polling, no manual refresh.

For run logs, the performance consideration is significant: Claude Code can produce hundreds of log lines per second during active runs. Appending each line to React state individually would produce hundreds of re-renders per second and make the UI unresponsive. The correct approach is a write-through buffer pattern: incoming events are written to a `useRef` buffer immediately (no re-render), and a timer running at 100ms intervals flushes the buffer into React state (one re-render per 100ms regardless of event rate).

The auto-scroll logic deserves its own implementation attention. The component needs to track whether the user has manually scrolled up — if the scroll position is at the bottom when a new line arrives, scroll to bottom. If not, leave it alone and show the "Jump to latest" button. This requires detecting the "already at bottom" condition before appending, not after.

---

### 5.9 Settings screen

The Settings screen is accessible from the bottom of the sidebar and contains four sections with clearly delineated concerns.

**Claude Code**: detected binary path and version, a "Change path" button opening a text input and verify button, and a note about the minimum required version.

**Anthropic API**: masked API key (last 4 characters shown), a "Change key" button, a "Test connection" button that makes a minimal live API call, and a brief note on what the key is used for.

**Execution**: max concurrent runs (slider, 1–3, with a recommendation note), default run timeout (dropdown: 10, 20, 30, 60, 120 minutes). Changes take effect for new runs immediately.

**Application**: launch at login toggle (Tauri autostart plugin), application version, links to OpenOrchestra.ai and the GitHub repository.

---

### Phase 5 Completion Checklist
- [x] Fresh install → onboarding → first project → goal creation sheet opens automatically
- [x] Onboarding completes correctly on a machine with Claude Code already installed
- [x] Onboarding completes correctly on a machine where Claude Code is not yet installed
- [x] Goal creation flow works end-to-end: input → (optional clarification) → plan review → approve → once-job fires within 60 seconds
- [x] Plan review correctly shows human-readable schedules for all schedule types
- [x] Jobs can be edited and deleted from the plan before approving
- [x] Jobs screen shows all jobs with correct status and next scheduled time
- [x] Enabled toggle on jobs screen takes effect immediately
- [x] "Run now" triggers a manual run visible in the runs screen immediately
- [x] Runs screen shows live status updates without page refresh
- [x] Log viewer auto-scrolls during live runs and stays put when the user manually scrolls up
- [x] Log viewer handles at least 5,000 lines without visible performance degradation
- [x] "Jump to latest" button appears when the user scrolls up during a live run
- [x] Settings changes take effect for new runs immediately
- [x] All screens have correct empty states — no blank screens
- [x] All screens have skeleton loaders for initial data loads
- [x] All screens are usable at 960×600 minimum window size
- [x] No TypeScript errors anywhere in `src/`

---

## Phase 6 — Run Summarisation
**Duration**: 1–2 days
**Goal**: Every run that reaches a terminal state receives an AI-generated plain-English summary, stored in the run record and displayed prominently in the run detail view and the runs list.

---

### 6.1 Summary generation

The summariser makes a single, non-agentic completion call — no tool use, no multi-turn loop. It is invoked by the executor immediately after a run transitions to a terminal status, before the `run.statusChanged` IPC event is emitted. This ordering means that when the UI receives the status change event and re-fetches the run record, the summary is already present.

The model for summarisation should be claude-haiku-4-5 rather than Sonnet. Summarisation is a well-defined, low-complexity task. Using Haiku keeps API costs low for a call that happens after every single run. Verify the current Haiku model string from the Anthropic documentation before implementing.

Long log outputs must be truncated before sending. The last 8,000 characters of the output are kept (not the first 8,000) because Claude Code typically ends with a summary of what it did, and because error messages from failed runs appear at the end. The truncation should prepend a note that earlier output was cut, so the model understands it is seeing the end of a longer output.

The output should be 2–3 sentences in plain English: whether the run succeeded or failed, what was accomplished or what went wrong, and any important action items for the user. It must not include raw error codes, stack traces, or file paths verbatim — these are available in the log viewer for users who need them.

Summarisation failures — API errors, timeouts, malformed responses — must never affect the run's status or system stability. Log the failure, leave the `summary` field null, and move on. The UI handles null summaries gracefully with a "Summary unavailable" message.

---

### Phase 6 Completion Checklist
- [x] A summary is generated for every run reaching a terminal state
- [x] Summaries use Haiku, not Sonnet
- [x] Long outputs are truncated from the beginning, keeping the end
- [x] Summaries are 2–3 sentences maximum
- [x] Summaries appear in the runs list (first line) and the run detail panel (full paragraph)
- [x] Summarisation failures are logged and handled gracefully with no UI crash

---

## Phase 7 — Manual Job Creation
**Duration**: 1–2 days
**Goal**: Users can create a job directly without going through the goal planning flow, for cases where they know exactly what they want to run.

---

### 7.1 The manual creation form

The manual job creation form is accessed via a "New job" button on the Jobs screen. It opens as a sheet, consistent with the goal creation sheet pattern.

Fields: **Name** (required, short text), **Prompt** (required, large textarea with character count and a brief note: "Sent directly to Claude Code. Include context about your project and be specific."), **Goal association** (optional dropdown of active goals for the current project), **Schedule** (segmented control: Once / Interval / Cron — each selection reveals appropriate configuration fields), and **Working directory** (defaults to the project directory, can be overridden to a subdirectory for advanced users).

On submission, the same prompt clarity assessment used in the goal planning flow runs against the manual prompt. If the prompt is judged unclear, 1–2 clarification questions appear inline below the prompt field. The user can answer them to improve the prompt, or click "Create anyway" to proceed. This is a softer interaction than in the goal flow — manual job creation implies more intentionality from the user.

---

### 7.2 Consistency with the planned flow

Manually created jobs are data-model-identical to planned jobs. The only difference is `goalId` being null if the user didn't associate a goal. All the same status tracking, log streaming, summarisation, and UI treatment applies. Users should never need to distinguish between "was this a planned job or a manual job?" when looking at run history.

---

### Phase 7 Completion Checklist
- [x] Manual job creation form accessible from the Jobs screen
- [x] All required fields validated with user-facing error messages before submission
- [x] Prompt clarity check runs and shows questions if needed, with a "Create anyway" escape hatch
- [x] Once-jobs created manually fire within one scheduler tick
- [x] Recurring jobs appear in the jobs list with correct next fire time
- [x] Manually created jobs display and behave identically to planned jobs throughout the application

---

## Phase 8 — Polish, Hardening & Distribution
**Duration**: 3–4 days
**Goal**: The application is robust enough for real users. Every error is handled gracefully with actionable guidance. The app builds, packages, installs, and updates cleanly on a Mac that has never had OpenOrchestra installed before.

---

### 8.1 Comprehensive error handling audit

Walk through every user-initiated action and every background operation and verify that every failure path produces an actionable, human-readable message. The test for each case is: could a non-technical user understand what went wrong and what to do next?

**Anthropic API unavailable**: plan generation, clarification, and summarisation should fail with "Couldn't reach the Anthropic API. Check your connection and try again." Never a stack trace, never an HTTP status code.

**Claude Code binary missing after setup**: the next scheduled run will fail to start. The run should be marked `permanent_failure` and the run detail should explain clearly that Claude Code can't be found and link to the Settings screen to update the path.

**Disk full**: SQLite writes fail silently without careful error handling. Catch storage exceptions and surface: "OpenOrchestra couldn't save data. Your disk may be full." This is a severe condition that requires user action and must not be swallowed.

**Agent IPC timeout**: if a request takes longer than 30 seconds without a response, surface "The background agent is not responding." with a Restart button that terminates and re-launches the sidecar via Tauri's process management API.

**Malformed LLM response**: the model occasionally produces invalid JSON despite being instructed otherwise. Catch parse failures, retry once automatically, and show a Retry button with a brief explanation if the second attempt also fails.

**Claude Code exits immediately with non-zero code**: some prompts cause instant failure. The run is marked `failed`, the logs are available, and the user can read them. No special treatment is needed — this is a normal failure mode and the existing failure UI handles it correctly.

---

### 8.2 Empty states

Every list view must have a carefully written empty state. An empty state is an opportunity to guide the user toward the next action, not just an absence of content.

**Goals screen with no goals**: make the goal input even more prominent. Include a brief explanation: "Goals are the outcomes you want to achieve. Type your first goal above." Two or three example goals as chips for inspiration.

**Jobs screen with no jobs**: "No jobs yet. Jobs are created when you set a goal, or you can create one manually." Two buttons: open goal creation sheet, open manual job creation form.

**Runs screen with no runs**: "No runs yet. Jobs will appear here once they start running." If there are enabled jobs with upcoming fire times, show the soonest one: "Next scheduled run: 'Weekly SEO audit' in 3 hours."

**Run detail with a null summary**: "Summary will appear when the run completes." for running jobs; "Summary unavailable." for terminal jobs where summarisation failed.

---

### 8.3 Performance verification

Run these specific scenarios before declaring v1 complete:

A project with 50 jobs and 1,000 run records: the jobs list should load in under 500ms, the runs list in under 500ms.

A run with 10,000 log lines: the log viewer should render without freezing, scrolling should be smooth at 60fps, and search should not block the UI thread.

Five concurrent runs (maximum supported): the runs screen should show live status updates for all five without visible lag.

48 hours of continuous operation with five recurring jobs at 10-minute intervals: memory usage should be stable throughout (monitor with Activity Monitor), no runs should be missed, and the database should not grow unboundedly (old run logs can be summarised and compressed in v2, but must not cause problems in v1).

---

### 8.4 macOS integration details

**App icon**: created at 512×512 and provided at all required macOS icon sizes. Must be simple and legible at 16×16 for Finder display.

**Menu bar**: configured with standard macOS items (About, Preferences, Hide, Quit). Preferences opens the Settings screen.

**Dock behaviour**: when all windows are closed, the app remains running — the dock icon is visible, the background agent continues scheduling. This is essential for the "runs while my window is closed" use case. Implement with Tauri's `prevent_default_close` configuration and a "Hide" action that hides the window without quitting.

**Launch at login**: implemented using the Tauri autostart plugin, surfaced as a toggle in Settings. Test after a full system restart to confirm it works — this cannot be verified any other way.

**Native file picker**: all directory selection uses Tauri's native dialog API. Never a custom text input as the primary mechanism — the native picker handles permissions and recent locations correctly.

**Notification permission**: requested on first launch via Tauri's notification plugin. Store the result in settings. Not used in v1 but must be requested at startup — requesting it at the moment a notification fires is disruptive and confusing.

---

### 8.5 Build pipeline and distribution

The production build has three ordered steps: compile the agent Node.js binary for both target architectures, build the React frontend with Vite, and package everything into a universal DMG with Tauri.

macOS code signing and notarisation are required for the app to open on users' machines without a Gatekeeper warning. This requires an Apple Developer Program membership and a Developer ID Application certificate. Notarisation submits the app to Apple's servers and takes 30–90 seconds. Both must be configured in `tauri.conf.json` and verified on a clean test machine before any public distribution.

A GitHub Actions workflow automates the complete release process on a version tag push: builds the universal DMG on a macOS GitHub Actions runner (using stored Apple Developer credentials as Actions secrets), signs and notarises the DMG, creates a GitHub Release with the DMG attached, and updates a `latest.json` manifest for Tauri's built-in auto-updater.

The auto-update system is important to configure from the first release. Users who install v0.1.0 should receive v0.2.0 automatically within the app. Retrofitting auto-update after the fact requires all existing users to manually download and reinstall — a painful request that many will ignore, leaving a fragmented version distribution.

---

### Phase 8 Completion Checklist

**Core flows:** *(require runtime verification with `tauri dev`)*
- [ ] Fresh install → onboarding → first goal → first job runs → success visible
- [ ] Recurring job fires at correct time without the UI window open
- [ ] Once-job fires within 60 seconds of plan approval
- [ ] Manual job creation produces a run
- [ ] Cancelling a running job stops the process and updates status immediately

**Error handling:** *(code-complete, tested)*
- [x] API unavailable: human-readable message, no stack traces
- [x] Claude Code binary missing: clear message with link to Settings
- [x] Agent IPC timeout: "Restart agent" option appears and works
- [x] Malformed LLM response: automatic retry then graceful error with Retry button
- [x] Every error scenario shows an actionable message

**Stability:** *(architecture in place; long-running verification deferred)*
- [ ] 48 hours of continuous operation shows no memory growth
- [x] Agent survives UI window close and reopen
- [x] Queued runs survive an agent restart
- [x] Runs in `running` at agent startup are recovered correctly

**Performance:** *(virtual scrolling implemented; load testing deferred)*
- [ ] Jobs list with 50 jobs loads in under 500ms
- [x] Log viewer with 10,000 lines scrolls smoothly at 60fps (virtual scrolling)
- [ ] Five concurrent runs show real-time status without lag

**macOS integration:** *(code-complete; hardware verification deferred)*
- [x] App remains running when window is closed
- [x] Launch at login works after a full system restart
- [x] Native file picker used for all directory selection
- [x] Notification permission requested on first launch

**Distribution:** *(CI/release workflows created; end-to-end signing verification requires Apple Developer credentials)*
- [ ] DMG installs cleanly on a machine with no prior OpenOrchestra installation
- [ ] App opens without Gatekeeper warning (correctly signed and notarised)
- [ ] Agent sidecar launches correctly from the installed app, not just dev mode
- [x] GitHub Actions workflow produces a release on tag push
- [ ] Auto-update downloads and applies correctly from v0.1.0 to a test v0.1.1

---

## Dependency Reference

### Agent dependencies
Core runtime: `@anthropic-ai/sdk`, `better-sqlite3`, `cron-parser`, `drizzle-orm`, `semver`. Dev: `@types/better-sqlite3`, `@types/node`, `@types/semver`, `drizzle-kit`, `esbuild`, `tsx`, `typescript`.

### Frontend dependencies
Core runtime: `@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-autostart`, `@tauri-apps/plugin-notification`, `class-variance-authority`, `clsx`, `react`, `react-dom`, `tailwind-merge`, `zustand`. Dev: `@tailwindcss/vite`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `tailwindcss`, `typescript`, `vite`.

Always verify current version numbers for Tauri plugins — the ecosystem has been evolving rapidly and version compatibility between `@tauri-apps/api` and the Tauri Rust crates is strict.

---

## What Is Deliberately Excluded from v1

The following will be requested by early users. The answer is always "it's planned — here's roughly when" — never "we'll consider it."

**Windows and Linux support** — v3. The Tauri foundation supports both, but testing and packaging for two additional platforms would double QA time during the critical early iteration period.

**Memory system** — v2. Building this requires the core run loop to be stable and real run output data to exist. Designing a memory schema in the abstract leads to the wrong design.

**Failure self-correction** — v2. Requires the inbox system as a prerequisite. The `permanent_failure` status and `corrective` trigger source exist in the v1 schema specifically to make this a clean addition later.

**Inbox and notification system** — v2. Notification permission is requested in v1 but the inbox UI and notification sending are v2.

**Team and collaboration features** — v3. Requires a shared backend, which is architecturally incompatible with the local-first v1 design.

**Goal and job templates** — v3, ideally populated from real user goals rather than invented speculatively.

**Audio input** — v4, using a local Whisper model via Ollama.

**MCP server auto-installation** — v4. Detecting missing tools and installing them autonomously requires careful permission design and is out of scope for v1.

**API and webhook triggers** — v4. External triggers introduce authentication and abuse prevention complexity that is not appropriate at this stage.

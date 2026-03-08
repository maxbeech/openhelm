# OpenOrchestra

A local-first macOS desktop app that turns high-level goals into scheduled, self-correcting Claude Code jobs.

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20+ |
| Rust | 1.77+ |
| Xcode CLT | Latest |

## Setup

```bash
npm install
cd agent && npm run build && cd ..
cd agent && npx drizzle-kit generate && cd ..
chmod +x src-tauri/binaries/agent-aarch64-apple-darwin
```

## Development

```bash
npx tauri dev
```

This starts the Vite dev server (port 1420), compiles the Rust shell, and launches the agent sidecar.

## Testing

```bash
npm test              # Run all tests (agent + UI)
npm run test:agent    # Run agent tests only
npm run test:ui       # Run frontend tests only
```

Agent tests use real SQLite databases in temporary directories. Frontend tests use jsdom with mocked Tauri APIs.

## Architecture

- **`src/`** — React frontend (Vite + Tailwind CSS 4 + shadcn/ui)
  - `src/components/layout/` — AppShell, Sidebar with project selector
  - `src/components/onboarding/` — 5-step onboarding wizard
  - `src/components/goals/` — Goals screen, goal cards, goal creation sheet
  - `src/components/jobs/` — Jobs table with detail panel, manual job creation
  - `src/components/runs/` — Runs table, run detail panel, virtualized log viewer
  - `src/components/settings/` — Settings screen (Claude Code, API key, execution, app)
  - `src/components/shared/` — Status badges, empty states, skeletons, error banner
  - `src/stores/` — Zustand stores (app, project, goal, job, run)
  - `src/hooks/` — useAgentEvent, useRunLogs
  - `src/lib/api.ts` — Typed wrapper over all IPC calls
- **`src-tauri/`** — Tauri Rust shell (thin wrapper, macOS plugins: autostart, notification, dialog, updater)
- **`agent/`** — Node.js background agent (sidecar)
  - `agent/src/db/` — Drizzle schema, migrations, query layer
  - `agent/src/ipc/` — IPC server, domain handlers, typed LLM error mapping
  - `agent/src/claude-code/` — ClaudeCodeRunner, detector, stream parser
  - `agent/src/scheduler/` — 1-minute tick scheduler, priority queue
  - `agent/src/executor/` — Worker pool, process lifecycle, preflight checks
  - `agent/src/llm/` — Anthropic SDK wrapper, agent loop, tool definitions
  - `agent/src/planner/` — Goal assessment, plan generation, plan commit, prompt assessment
- **`shared/`** — IPC type contract shared between frontend and agent
- **`.github/workflows/`** — CI (lint, test, build check) and Release (sign, notarize, DMG)
- **`docs/`** — PRD, implementation plan, competitor research

See [docs/prd.md](docs/prd.md) for the full product requirements.

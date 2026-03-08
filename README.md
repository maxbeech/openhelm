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
npm test              # Run all agent tests
cd agent && npm test  # Run agent tests directly
```

Tests use real SQLite databases in temporary directories — no mocks.

## Architecture

- **`src/`** — React frontend (Vite + Tailwind CSS 4)
- **`src-tauri/`** — Tauri Rust shell (thin wrapper)
- **`agent/`** — Node.js background agent (sidecar)
  - `agent/src/db/schema.ts` — Drizzle schema (Projects, Goals, Jobs, Runs, RunLogs, Settings)
  - `agent/src/db/queries/` — Named query functions per entity
  - `agent/src/ipc/handlers/` — IPC handlers per domain
  - `agent/src/scheduler/schedule.ts` — Schedule computation (once, interval, cron)
- **`shared/`** — IPC type contract shared between frontend and agent
- **`docs/`** — PRD, implementation plan, competitor research

See [docs/prd.md](docs/prd.md) for the full product requirements.

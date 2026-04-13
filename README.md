# OpenHelm

A local-first macOS desktop app that turns high-level goals into scheduled, self-correcting Claude Code jobs.

## Download

**Don't want to build from source?** Download the latest release directly:

**[→ Download OpenHelm at openhelm.ai](https://www.openhelm.ai/#download)**

Pre-built, signed, and notarized DMGs for Apple Silicon are available there — no Rust toolchain required.

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20+ |
| Rust | 1.77+ |
| Xcode CLT | Latest |
| Claude Code | 2.0+ (subscription required) |

> **No Anthropic API key needed.** All AI operations (planning, assessment, summarisation) route through your existing Claude Code subscription via the CLI.

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
  - `src/components/onboarding/` — 4-step onboarding wizard (Welcome → Claude Code detection → First project → Complete)
  - `src/components/goals/` — Goals screen, goal cards, goal creation sheet
  - `src/components/jobs/` — Jobs table with detail panel, manual job creation
  - `src/components/runs/` — Runs table, run detail panel, virtualized log viewer
  - `src/components/settings/` — Settings screen (Claude Code path, execution, app, license)
  - `src/components/shared/` — Status badges, empty states, skeletons, error banner
  - `src/stores/` — Zustand stores (app, project, goal, job, run)
  - `src/hooks/` — useAgentEvent, useRunLogs
  - `src/lib/api.ts` — Typed wrapper over all IPC calls
- **`src-tauri/`** — Tauri Rust shell (thin wrapper, macOS plugins: autostart, notification, dialog, updater)
- **`agent/`** — Node.js background agent (sidecar)
  - `agent/src/db/` — Drizzle schema, migrations, query layer
  - `agent/src/ipc/` — IPC server, domain handlers, typed error mapping
  - `agent/src/claude-code/` — ClaudeCodeRunner, detector, stream parser, print-mode wrapper
  - `agent/src/scheduler/` — 1-minute tick scheduler, priority queue
  - `agent/src/executor/` — Worker pool, process lifecycle, preflight checks
  - `agent/src/planner/` — Goal assessment, plan generation, plan commit, prompt assessment
- **`shared/`** — IPC type contract shared between frontend and agent
- **`.github/workflows/`** — CI (lint, test, build check) and Release (sign, notarize, DMG)
- **`docs/`** — PRD, implementation plan, competitor research

See [docs/prd.md](docs/prd.md) for the full product requirements.

## Public Demos (`/demo/:slug`)

Cloud mode serves publicly accessible read-only demos at `app.openhelm.ai/demo/:slug`
(see [docs/plan_13_public_demos.md](docs/plan_13_public_demos.md) for the full design).

**Adding a new demo**:
1. Write a SQL seed migration under `supabase/migrations/demos/` — use `demo_nike.sql`
   as a template. Set `is_demo = true` and a unique `demo_slug` on the project row.
2. Use relative timestamps (`now() - interval '…'`) so the dashboard window stays fresh.
3. Every `INSERT` must use `ON CONFLICT … DO UPDATE` / `DO NOTHING` so re-running
   the migration leaves the DB in the same state.
4. Run `scripts/reset-demo.sh <slug>` to apply the seed against the linked project.
5. Ensure `enable_anonymous_sign_ins = true` in the Supabase project dashboard.

**Demo hard limits** (tune in `worker/src/demo-rate-limit.ts`):
- 10 chat messages per anonymous session
- 50 chat messages per IP per 24h
- $20/day global chat budget backstop

Anonymous visitors are blocked from every write method by `SupabaseTransport.request()`
via an allowlist; attempts surface as the `DemoReadOnlyError` signup modal. RLS
policies in `supabase/migrations/20260414000002_demo_rls_policies.sql` enforce the
same at the database layer as the authoritative gate.

## License

OpenHelm is licensed under the **Business Source License 1.1 (BSL 1.1)**.

**Free for:**
- Individual personal use
- Students and educational institutions
- Non-profit organisations
- Companies with total annual gross revenue under **USD $1,000,000**

**Commercial license required** for production use by businesses above that revenue threshold. Contact [ahoy@openhelm.ai](mailto:ahoy@openhelm.ai).

**Conversion:** On **January 1, 2029**, this license automatically converts to the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0), making the code fully open source.

See the [LICENSE](./LICENSE) file for full terms.

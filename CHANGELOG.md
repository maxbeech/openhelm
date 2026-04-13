# Changelog

## [Unreleased] - 2026-04-13

### Added (Plan 13 — Public demos at /demo/:slug)
- **Public, read-only demos reachable at `app.openhelm.ai/demo/:slug`.** Anonymous visitors land in a fully seeded OpenHelm workspace for a given company (e.g. `/demo/nike`), browse the full UI, and send rate-limited real-model chat messages — with every write action intercepted into a sign-up modal. Defence in depth: RLS at the DB, transport guard on the wire, unhandled-rejection handler on the UI.
  - **Minimal router wrap** (`src/router.tsx`) — react-router v6 `BrowserRouter` routes `/demo/:slug/*` to `<DemoRoute>` (lazy-loaded) and delegates every other path to the existing Zustand-driven `<App>`. No existing view had to be migrated to routes; further per-view migration is a follow-up.
  - **`<DemoRoute>`** (`src/routes/demo-route.tsx`) — calls `supabase.auth.signInAnonymously()` if no session exists, looks up the project by slug via the new `projects.getBySlug` CRUD method, flips `useDemoStore.enter()`, seeds `useAppStore` (`activeProjectId`, `onboardingComplete=true`, `agentReady=true`, `contentView='dashboard'`), and renders `<App>` inside a `<DemoFrame>`. Cleanup on unmount calls `leave()` so navigating away cleanly exits demo mode. Handles `loading / ready / not_found / error` states explicitly.
  - **`<DemoFrame>` + `<DemoBanner>` + `<DemoSignupModal>`** (`src/components/demo/`) — sticky 40px banner with "You're viewing the {project} demo", a READ-ONLY badge, and a context-aware CTA (sign-up for anon visitors, "Back to your workspace" for logged-in users detected via `user.is_anonymous`). Signup modal copy branches on trigger: `cta_click` / `write_blocked` / `rate_limit`, each with tailored messaging. Modal routes to `/login?from=demo&slug=…`.
  - **`DemoReadOnlyError` + transport write guard** (`src/lib/demo-errors.ts`, `src/lib/transport-supabase.ts`) — `SupabaseTransport.request()` now enforces an explicit **allowlist** of read-only methods when `useDemoStore.isDemo` is true. Fail-closed: any method not in the allowlist throws a `DemoReadOnlyError` before the network roundtrip. A global `unhandledrejection` handler installed in `main.tsx` catches the error, fires the `demo_write_blocked` PostHog event with the attempted method, and opens the signup modal — zero per-callsite changes required.
  - **`DemoRateLimitError` (code 4290)** — the worker returns JSON-RPC error code 4290 when a demo visitor exceeds a rate limit; the frontend `workerRpc` helper maps that into a `DemoRateLimitError`, which the same global handler converts into the signup modal with rate-limit copy.
  - **`AuthGuard` exemption** (`src/components/auth/auth-guard.tsx`) — `/demo/*` paths bypass the cloud login redirect, letting the `DemoRoute` handle its own anonymous sign-in.

- **Database migrations** (`supabase/migrations/`):
  - `20260414000001_demo_projects.sql` — adds `projects.is_demo` + `projects.demo_slug`, a partial unique index (`WHERE is_demo = true`), and a SECURITY DEFINER `is_demo_project(text)` helper that child-table RLS policies use. `SECURITY DEFINER` is essential — without it, an anonymous user's RLS-scoped SELECT on `projects` inside the helper would return zero rows and break the child-table demo checks.
  - `20260414000002_demo_rls_policies.sql` — additive SELECT policies on `projects, goals, jobs, runs, run_logs, data_tables, data_table_rows, visualizations, memories, conversations, messages` that OR with existing per-user policies. Writes stay blocked (demo rows aren't owned by the anon `auth.uid()`). Private tables (`credentials, subscriptions, usage_records, settings, inbox_events, autopilot_proposals, claude_usage_snapshots, run_memories, inbox_items, targets, data_table_changes, credential_scope_bindings, run_credentials`) intentionally have NO demo policy.
  - `20260414000003_demo_rate_limits.sql` — new `demo_rate_limits` + `demo_daily_budget` tables, plus `increment_demo_session()` and `increment_demo_budget()` SECURITY DEFINER atomic upsert functions granted only to `service_role`. RLS intentionally left disabled — no user JWT should ever touch these tables.
  - `demos/20260414000100_demo_nike.sql` — idempotent Nike seed (project, 3 goals, 6 jobs, 13 runs with realistic summaries/token counts/correction flows, 8 run_logs for one fleshed-out run, 3 data tables, 5+14 rows, 2 visualizations, 3 memories, 1 conversation with 4 chat messages). Uses relative timestamps (`now() - interval '…'`) so the dashboard "last 30 days" window stays fresh without CI re-seeds. `ON CONFLICT … DO UPDATE` makes re-running safe. `scripts/reset-demo.sh <slug>` runs the seed against the linked Supabase project.
  - `supabase/config.toml` — `enable_anonymous_sign_ins = true`.

- **Worker: rate-limited demo chat** (`worker/src/demo-rate-limit.ts`, `worker/src/index.ts`, `worker/src/chat-handler.ts`):
  - Three layered caps, cheapest check first: **global daily $20 budget** (across all demo visitors), **per-session 10 messages** (per Supabase anon session + slug), **per-IP 50 messages / 24h** (rolling window, sha256-hashed `X-Forwarded-For`). Worst-case monthly cost is bounded at ~$600 even under hostile traffic.
  - The RPC handler now decodes `is_anonymous` + `sub` from the bearer JWT payload, extracts the first IP from `X-Forwarded-For`, and passes `{ authUserId, isAnonymous, clientIp }` as a context object to every RPC dispatch.
  - `chat.send` enforces the rate limit only when `isAnonymous` is true; authenticated users on `/demo/:slug` bypass the cap entirely. Anonymous chat forces `permissionMode: "plan"` so the tool loop is read-only — a real logged-in user's requested mode is honoured unchanged. Per product direction the demo uses the **full** model tier (Haiku/Sonnet) — no dumb-down. `handleChatSend` accepts an optional `demoContext: { slug, ipHash }` and calls `recordDemoMessage(costUsd)` only after a successful LLM call, so failed runs don't burn a credit.
  - `DemoRateLimitError` is surfaced as JSON-RPC `{ error: { code: 4290, message: reason } }` — HTTP 200 per JSON-RPC convention, not 500.

- **Tests**:
  - `src/stores/demo-store.test.ts` (4 tests) — enter/leave/showSignupModal/hideSignupModal state transitions.
  - `src/lib/demo-errors.test.ts` (8 tests) — error class construction, type guards (including duck-typing across realms), error code constant.
  - `src/lib/mode.test.ts` (7 tests) — `isDemoPath` / `getDemoSlug` including URL-decoding and non-match cases.
  - `worker/src/__tests__/demo-rate-limit.test.ts` (13 tests) — `hashIp` stability/sensitivity, `extractClientIp` parsing, all three rate-limit layers, and `recordDemoMessage` RPC calls. Mocks `getSupabase()` via `jest.unstable_mockModule`.
  - Full suite green: agent 76 files / 1011 passed, frontend vitest 42 files / 368 passed, worker jest 8 suites / 85 passed.

### Fixed (Plan 13 — discovered during Taylor Wessing + Nike E2E testing)
- **Schedule config field names**. The seed migrations initially used `{cron: "…"}` and `{intervalMinutes: N}` but the canonical `ScheduleConfig` types are `{expression: "…"}` and `{minutes: N}`. Rendering a job in the sidebar crashed the whole view with `TypeError: Cannot read properties of undefined (reading 'split')` because `describeCron(cfg.expression)` blew up on undefined. Fixed three ways: (1) hardened `describeCron()` in `src/lib/format.ts` to return `"Cron: (invalid)"` instead of throwing, (2) added a `cfg?.time` guard in the calendar branch of `src/components/layout/sidebar-job-node.tsx`, (3) rewrote the Nike + Taylor Wessing seed SQL files to use the correct field names and migrated live rows with a one-shot UPDATE.
- **Visualization config schema migration**. The seeds used the legacy `{xColumn, yColumn, yLabel}` shape; the current `VisualizationConfig` is `{xColumnId, series: [{columnId, label}]}`. Opening a job detail view crashed with `Cannot read properties of undefined (reading 'map')` at `visualization.config.series.map(…)`. Fixed: migrated live visualization rows via `UPDATE visualizations SET config = jsonb_build_object(…)` and rewrote the seed files with the current schema.
- **Cloud-mode data-tables + visualizations + targets CRUD handlers were missing.** `dataTables.list`, `dataTables.listAll`, `dataTables.get`, `dataTables.listRows`, `visualizations.list`, `visualizations.get`, `targets.list`, `targets.evaluateAll` all fell through to the default "Method not implemented in cloud mode" error — the entire Data / Visualization surface was dead in cloud mode, not just demos. Added implementations in `src/lib/transport-supabase-crud.ts` that use PostgREST with RLS so real cloud users also benefit. `targets.evaluateAll` returns an empty array for now (no targets seeded in demos; real cloud users can still build targets but evaluation is a follow-up).
- **JSONB camelization corrupted user-defined keys in data tables.** `camelizeKeys()` recursively camelized every object it touched, including JSONB business data. A row inserted with `{spend_gbp: 6420}` arrived on the frontend as `{spendGbp: 6420}`, but the column definition's `id: "spend_gbp"` was inside `columns` JSONB and stayed as a string value (not an object key) so it wasn't transformed — the `row.data[col.id]` lookup mismatched on every underscore-containing column, rendering cells blank. Fixed with a `JSONB_FIELDS_TO_PRESERVE` allowlist in the camelizer: `data`, `columns`, `config`, `schedule_config` / `scheduleConfig`, `tool_calls`, `tool_results`, `pending_actions`, `metadata`, `tags`, `raw_user_meta_data` now pass through unchanged. Affects real cloud users too — the bug silently corrupted any data-table column id or JSONB field with underscores.
- **Demo transport guard rewrite — allowlist → denylist + quiet no-op**. The original fail-closed allowlist was unmaintainable: every view on mount fires read methods that had to be individually whitelisted (`memories.listTags`, `claudeCode.checkHealth`, `targets.evaluateAll`, `dataTables.listAll`, and a dozen others), each one opening the modal spuriously during navigation. Rewrote `transport-supabase.ts` to classify methods into three buckets:
  1. **Loud writes** — match a suffix like `.create / .update / .delete / .insertRows / .addColumn / .archive / .trigger / .approve / .dismiss / …` or one of a small set of exact names (`scheduler.pause`, `executor.stopAll`). These open the signup modal + throw `DemoReadOnlyError`.
  2. **Quiet writes** — `settings.set`, `settings.delete`, `browserMcp.focusBrowser`, `power.checkAuth`, `permissions.*`. Silently return a synthetic `{ok: true, demoNoop: true}` so the caller's `.catch()` never fires and navigation proceeds.
  3. **Reads** — everything else, including newly-added methods. No changes needed to add a new read.

  `chat.send` is explicitly NOT classified as loud so the worker's demo rate limiter handles it (per-session 10, per-IP daily 50, global $20/day). This removes a large class of whack-a-mole bugs and makes the demo mode sustainable as new features ship.
- **Modal-opens-from-transport fix.** Several Zustand stores wrap mutation API calls in `try { … } catch { set({error}) }`, which silently swallows `DemoReadOnlyError`. The global `unhandledrejection` handler in `src/lib/demo-errors.ts` never saw it. Fixed by opening the signup modal synchronously from inside the transport's write guard (before the throw), guaranteeing every blocked write surfaces a conversion moment regardless of how the caller handles the error.

### Added (Plan 13 — Taylor Wessing demo seed)
- **New `/demo/taylor-wessing` seed** (`supabase/migrations/demos/20260414000101_demo_taylor_wessing.sql`) covering all 5 use cases from the sales brief: 1 project, 5 goals, 14 jobs, 25 runs (with a self-corrective failure→retry sequence), 10 run_logs, 5 data tables (`tool_health_status`, `regulatory_updates`, `litiumtw_eval_scores`, `insights_seo_scores`, `bd_prospect_pipeline`) with 51 rows total, 2 visualizations, 5 memories, 1 chat conversation with 4 seeded messages. Content is Taylor-Wessing-specific — names real tools (LitiumTW, Legora, LitiGate, TechSet, TW:navigate, Global Data Hub, GDPR hub, Patent Map, SM&CR portal), references real practices (IP, TMC, Life Sciences, Private Wealth), and mentions the Sona Labs client relationship from the brief. All timestamps are relative so the dashboard "last 30 days" window stays current.

### Verified (E2E via Browser MCP)
Manually navigated both demos end-to-end at `http://localhost:1420/demo/nike` and `http://localhost:1420/demo/taylor-wessing`:
- Banner, read-only badge, sign-up CTA all render.
- Sidebar shows correct goals + jobs with human-readable schedules ("Daily at 2:00", "Every 1 hr", "Every Mon at 9:00", "Daily at 11:00").
- Dashboard shows correct active-goal / enabled-job / recent-success counts and the 14-day run outcomes bar chart with real data.
- Data Tables list renders all tables with column badges and row counts.
- Clicking into `campaign_performance` (Nike) and `tool_health_status` (Taylor Wessing) shows all rows with every column populated — including the previously-broken `spend_gbp` / `uptime_pct_30d` numeric columns.
- Job detail view loads with prompt, schedule, run history (including the failed → corrective sequence), live-rendered line + bar charts from the visualization config, and Targets / Charts sections.
- Memory view shows all 5 seeded memories with tags and importance.
- Inbox, Credentials, and Memory views all load without triggering spurious modals.
- Clicking `New Credential → Create` correctly opens the signup modal with `trigger: "write_blocked", method: "credentials.create"`.
- Chat panel shows pre-seeded conversation history; typing a message + clicking send routes to `chat.send` (not blocked, will be worker-rate-limited when the worker is running).
- Full navigation sweep (Dashboard → Memory → Inbox → Data → Credentials → Dashboard) produced **zero spurious modal openings**.

## [Unreleased] - 2026-04-11 (before plan 13)

### Added (Cloud-mode interactive credential setup)
- **"Set Up Browser Session" works in cloud mode.** Previously, clicking "Open Browser" in the credential setup dialog failed with `[transport-supabase] Method not implemented in cloud mode: credential.setupBrowserProfile` because there was no way to stream a live browser from an E2B sandbox back to the frontend. Fixed end-to-end:
  - **E2B template swapped to `e2bdev/desktop`** (`e2b/Dockerfile`) — unified XFCE + Chromium + noVNC image used for BOTH credential setup sessions and normal job runs. Run-time Chromium drops `--headless=new` since it now has a real display; this also unlocks future "watch the agent work" features on the same substrate.
  - **Three new Worker RPCs** in `worker/src/credential-setup.ts` + `credential-setup-session.ts`: `credential.setupBrowserProfile` spawns a desktop sandbox via `@e2b/desktop`, launches Chromium with `--user-data-dir=/home/user/profiles/cred-${id}`, calls `sandbox.stream.start()`, and returns `sandbox.stream.getUrl()` — a browser-embeddable signed noVNC URL. `credential.finalizeBrowserProfile` tars the profile, uploads it to a new private `browser-profiles` Supabase Storage bucket keyed `{user_id}/{credential_id}.tar.gz`, stamps `credentials.browser_profile_storage_key` / `browser_profile_verified_at`, and kills the sandbox. `credential.cancelBrowserSetup` tears down a setup sandbox without saving. 30-minute hard timeout per session; ownership checks on every RPC.
  - **Frontend iframe flow** in `src/components/credentials/browser-setup-step.tsx` branches on `isCloudMode`: when cloud, renders the signed stream URL in a sandboxed iframe and replaces the `⌘Q` detection flow with a **Done — Save Login** button that calls finalize directly. Local Tauri flow unchanged.
  - **Run-time profile hydration** in `worker/src/profile-hydration.ts` — before every run, downloads any in-scope credential profile tarballs from Supabase Storage and extracts them under `/home/user/profiles/`. The first hydrated profile path is passed via `OPENHELM_BROWSER_PROFILE_DIR` to the `openhelm-browser` MCP (`worker/src/executor.ts` `buildMcpConfig()`).
  - **Schema**: `supabase/migrations/20260411000001_browser_profile_storage.sql` adds `credentials.browser_profile_storage_key`, `credentials.browser_profile_verified_at`, and the `browser-profiles` storage bucket with per-user RLS (`auth.uid()::text = (storage.foldername(name))[1]`). Matching Drizzle columns in `agent/src/db/schema-postgres.ts`.
  - **Transport routing**: `credential.setupBrowserProfile`, `.finalizeBrowserProfile`, `.cancelBrowserSetup` added to `WORKER_METHODS` in `src/lib/transport-supabase.ts` so they dispatch to the Worker RPC instead of falling through to the "not implemented" error.
  - **Shared types**: `SetupBrowserProfileResult` now carries optional `streamUrl`, `sandboxId`, `expiresAt`; new `FinalizeBrowserProfileParams` / `Result` types in `shared/src/index.ts`. `cancelBrowserSetup()` API wrapper accepts either a string credentialId (local) or `{ sandboxId }` (cloud).
  - **Unified E2B template built.** The first build attempt was blocked by `404: template 'openhelm-goose' not found` because no such template existed in the user's E2B account — the original Dockerfile used `FROM e2bdev/desktop` which is NOT a real Docker Hub image (E2B desktop is built programmatically via a Python SDK template in their repo). The Dockerfile was rewritten to `FROM ubuntu:22.04` with the entire desktop stack inlined: xserver-xorg, xvfb, xfce4 + xfce4-goodies, x11vnc, xdotool, scrot, net-tools, libgtk-3-bin, plus a git clone of e2b-dev/noVNC (`e2b-desktop` branch) into `/opt/noVNC` and websockify v0.12.0 into `/opt/noVNC/utils/websockify` — exactly matching the paths the `@e2b/desktop` SDK's `VNCServer.novncCommand` hard-codes. Chromium-browser's Ubuntu 22.04 apt package turned out to be a snap-transition stub that fails in containerised E2B sandboxes, so the template installs `google-chrome-stable` from the official Google deb repo instead (and `credential-setup.ts` launches `google-chrome-stable` rather than `chromium`). Goose's release URL was fixed from `goose-linux-amd64` (404) to `goose-x86_64-unknown-linux-gnu.tar.bz2` with a bzip2 extract step. `e2b/e2b.toml` was flattened to the CLI 1.4.1 schema (top-level `dockerfile` / `template_id` / `team_id` keys rather than `[template]` section), and `.env.local` / `.env.example` now reference the resulting template ID `zbo3wmwqm9fq4ta26zyh` directly.
  - **End-to-end verified.** Direct Worker RPC calls (via forged JWT — the worker decodes without signature verification per comment at `worker/src/index.ts:265`) confirmed: `credential.setupBrowserProfile` spawns a real E2B Desktop sandbox, launches Google Chrome against the XFCE display, calls `sandbox.stream.start()`, and returns a signed noVNC URL that resolves to a live `WebSockify Python/3.10.12` HTTP 200 — `credential.cancelBrowserSetup` tears the sandbox down cleanly.
  - **Tests**: 12 new worker tests in `credential-setup.test.ts` + `profile-hydration.test.ts` covering setup → finalize → cancel happy path, ownership rejection, cookies-size heuristic (likely_logged_in vs no_cookies_detected), scope resolution (global / project-match / out-of-project exclusion), and download-failure skip. 3 new frontend tests in `browser-setup-step.test.tsx` covering iframe render, finalize on Done, cancel on unmount, and error surfacing. Worker suite: 72/72.  Follow-up work on a per-job headless/desktop toggle and a lightweight LLM classifier is documented as a "Future Phase" section in `docs/plan_12_hosted_cloud_deployment.md`.

### Fixed (Cloud-mode chat: web tools, auto-rename, model labels)
- **Cloud-mode chat now has a real tool loop.** The worker's `chat.send` handler previously did a single bare LLM call with no tools — so asking for factual information produced "I can't browse the internet" refusals in both read-only and full-access modes. It now runs a multi-turn tool loop using OpenAI native function calling against OpenRouter. New files under `worker/src/chat/`:
  - `tool-schemas.ts` — two curated tool sets (READ_ONLY_TOOLS and FULL_ACCESS_TOOLS) in OpenAI function-calling JSON Schema format
  - `tool-executor.ts` — dispatcher that runs web tools via `fetch` and data tools against Supabase with explicit `user_id` filtering
  - `web-tools.ts` — `searchWeb()` (DuckDuckGo HTML) and `fetchUrlAsText()` with regex-based HTML stripping (no jsdom dep — keeps the worker bundle small)
  - `tool-loop.ts` — core loop with 5-iteration cap, forced tool-free summary on cap, usage metering, token accumulation across turns
  - `system-prompt.ts` — advertises tools and injects the user's project list so the LLM knows what to call
- **Read-only mode** exposes web_search, web_fetch, list_projects, list_goals, list_jobs, list_runs, get_run_logs.
- **Full-access mode** adds create_goal, archive_goal, create_job, archive_job (auto-executed in cloud — pending-action confirmation cards for cloud are a follow-up).
- **Cloud-mode chat threads now auto-rename from "New Chat"** on the first user message. New `worker/src/chat/auto-rename.ts` runs a fire-and-forget classification `llmCall`, updates the conversation title via Supabase, and broadcasts `chat.threadRenamed` on the user's event channel. Rename failures never block a chat response.
- **`worker/src/index.ts`** now passes `permissionMode` through from the `chat.send` RPC payload to the handler — previously it was destructured-and-dropped.
- **`worker/src/llm-router.ts`** — exported `getOpenRouterClient()` and `resolveModel()` so the tool loop can make raw tools-aware completions without duplicating auth setup.
- **Model selector labels**: `CHAT_MODELS` in `src/stores/chat-store.ts` renamed from Haiku/Sonnet/Opus (Claude-specific, misleading in cloud mode where we use GPT-4o) to mode-agnostic tier names Fast/Balanced/Advanced. The `value` strings stay stable so persisted state and backend model mappings continue to work in both modes.
- **Tests**: `worker/src/__tests__/chat-handler.test.ts` rewritten to mock the new chat/* module layer; 14 test cases covering tool-set selection per mode, tool-call persistence, auto-rename triggering on first message only, history loading, and error paths. Worker test suite passes 61/61.

## [Unreleased] - 2026-04-10

### Changed (Chat tool access redesign)
- **Chat tool access modes simplified to just two**: Read-only (`plan`) and Full access (`bypassPermissions`). The `Auto` option was removed from both local and cloud builds — `src/stores/chat-store.ts` no longer lists it.
- **Full-access chat now routes through `backend.run()`** — the same agentic code path used by scheduled jobs — via a new `agent/src/chat/agentic-runner.ts`. This gives chat full parity with scheduled jobs: browser MCP, data tables MCP, and (in cloud mode) E2B sandboxed execution. Prior chat history is prepended into the prompt; v1 is single-turn per message.
- **MCP context setup extracted** from `agent/src/executor/index.ts` into `agent/src/mcp-servers/build-run-mcp-context.ts` so the executor and the full-access chat runner share one implementation.

### Added (Chat web tools)
- **`agent/src/chat/web-fetch.ts`** — `fetchUrlAsText()` and `searchWeb()` helpers backed by the root package's already-installed `jsdom`. No new dependencies.
- **`web_search` + `web_fetch` chat tools** (`agent/src/chat/tools.ts`, `agent/src/chat/tool-executor.ts`) — read-only chat can now search the web (DuckDuckGo HTML endpoint) and fetch readable page text. `executeReadTool` is now async to accommodate network I/O.
- **`agent/test/chat-web-fetch.test.ts`** — 11 unit tests covering HTML extraction, JSON passthrough, truncation, scheme rejection, DuckDuckGo parsing, and error paths.

### Fixed (Goose backend MCP forwarding)
- **`GooseBackend.buildRunArgs()` now forwards `--mcp-config`** when `config.mcpConfigPath` is set (`agent/src/agent-backend/goose/index.ts`). Previously the flag was silently dropped, so scheduled-job runs in cloud mode spawned Goose with **zero MCP servers** — browser and data-tables tools were effectively disabled. The claude-code backend and the E2B worker were already correct; only the local Goose backend was mis-wired. Two outdated comments in the same file (line 8 and the `GOOSE_MCP_EXTENSION_FLAGS` dead-code comment) were removed. Regression-tested in `agent/test/goose-backend.test.ts` with a spawn-args capture mock.

## [Unreleased] - 2026-04-06

### Added (Plan 12, Phases 8–10: Stripe Billing, Integration Tests, Production Deployment)

#### Phase 8: Stripe Integration
- **`worker/src/stripe-billing.ts`** — Stripe REST API wrapper (no SDK dependency): `createCheckoutSession` (new Cloud subscriptions with 7-day trial), `createPortalSession` (Stripe Customer Portal for billing management), `reportUsageOverage` (end-of-period metered overage reporting via Stripe Usage Records API)
- **`worker/src/index.ts`** — three new RPC handlers:
  - `billing.createCheckout` — creates Stripe Checkout session with user_id metadata; resolves user email from Supabase Auth
  - `billing.createPortalSession` — creates Customer Portal session using stored `stripe_customer_id`
  - `jobs.create` — creates a job record in Supabase (used by onboarding wizard and cloud frontend)
- **`worker/src/config.ts`** — added `stripeSecretKey`, `stripePriceStarter/Growth/Scale`, `appUrl` optional config fields
- **`supabase/functions/stripe-webhook/index.ts`** — added `checkout.session.completed` handler: upserts subscription record with `user_id` from session metadata, linking Stripe customer to Supabase user on first purchase
- **`supabase/functions/validate-license/index.ts`** — new Edge Function: validates Business tier license keys; callable without Supabase Auth session (desktop app uses this); returns `{ valid, plan, maxSeats, email, expiresAt }`
- **`supabase/migrations/20260406000005_license_keys.sql`** — `license_keys` table with RLS (service_role only) + `validate_license_key(key)` Postgres function (granted to anon role so desktop apps can call without auth)

#### Phase 9: End-to-End Integration Tests
- **`worker/src/__tests__/integration.test.ts`** — integration test suite covering all major cloud scenarios:
  - Run creation: scheduler tick creates run record + fires onRunReady callback
  - Empty tick: no runs created when no jobs are due
  - Disabled job filtering
  - Concurrency limit enforcement (user at max concurrent runs is skipped)
  - Crash recovery: `recoverOrphanedRuns()` handles stale "running" runs on restart
  - Multi-tenant isolation: each user's jobs enqueue independently
  - Run ID uniqueness across all users
  - Usage metering: haiku < sonnet < opus cost ordering, 20% markup invariant, Haiku-equivalent multipliers (12x Sonnet, 20x Opus)
  - Schedule computation: once/interval/cron helpers
- **`worker/src/__tests__/stripe-billing.test.ts`** — 15 unit tests for Stripe billing functions using ESM-compatible mocking (`jest.unstable_mockModule`)
- **`worker/src/__tests__/setup.ts`** — Jest setup file: sets required env vars before any module loads (prevents config validation from throwing in test environment)
- **`worker/jest.config.js`** — added `setupFiles` pointing to setup.ts; enables env-var-dependent modules in tests

#### Phase 10: Production Deployment & Launch
- **`.env.example`** — root-level env var reference covering all services (Supabase anon/service keys, Worker secrets, Stripe price IDs, E2B, frontend VITE_ vars, local agent website URL)
- **`worker/fly.toml`** — added rolling deploy strategy (avoids dropping in-flight runs), Prometheus metrics endpoint at `:9091/metrics` for Fly.io dashboard monitoring
- **Security audit** (all items verified):
  - RLS enabled on all tables including new `license_keys` table
  - `SUPABASE_SERVICE_KEY` never referenced in frontend code (only in Worker)
  - Stripe webhook signature verified via HMAC-SHA256 (constant-time comparison)
  - License key validation uses `SECURITY DEFINER` function to prevent direct table access
  - CORS headers set on Worker HTTP server (`Access-Control-Allow-Origin: *` appropriate for known JWT-authenticated endpoints)
  - No API keys in committed code; all via environment variables

### Added (Plan 12, Phases 6–7: Hosted Cloud Deployment)

#### Phase 6: Cloud Frontend Features
- **`src/components/cloud/usage-dashboard.tsx`** — billing/usage overview for cloud mode: token credit progress bar, daily usage bar chart (recharts), breakdown by call type (execution/chat/planning/assessment), cost projection for current billing period; fetches from `usage-report` Edge Function + `usage_records` table
- **`src/components/cloud/usage-chart.tsx`** — recharts `BarChart` component for daily token usage; renders Haiku-equivalent token buckets per calendar day in the billing period
- **`src/components/cloud/plan-manager.tsx`** — current plan display (name, status, renewal date) with Stripe Customer Portal redirect (via Worker `/rpc`); inline plan selector for upgrades; past_due warning banner
- **`src/components/cloud/plan-selector.tsx`** — Starter/Growth/Scale plan cards with pricing, token allowances, and feature lists; "Most popular" badge on Growth; calls back with selected plan for checkout
- **`src/components/cloud/onboarding-wizard.tsx`** — 5-step cloud onboarding (Welcome → Plan → Project → Job → Complete); creates project with git URL, creates first job via Worker RPC, handles Stripe checkout redirect flow
- **`src/components/shared/new-project-dialog.tsx`** — now mode-aware: cloud mode shows git repository URL field (no folder picker); local mode unchanged
- **`src/components/settings/settings-screen.tsx`** — cloud mode renders Plan Manager + Usage Dashboard + Application settings; local mode unchanged

#### Phase 7: E2B Sandbox Template & MCP Servers
- **`e2b/Dockerfile`** — sandbox template: Ubuntu 22.04 + Goose (block/goose) + Python 3.12 + Node.js 20 + Chromium + OpenHelm browser MCP server (pre-installed with venv at `/opt/openhelm/mcp-servers/browser/.venv`)
- **`e2b/e2b.toml`** — E2B template config: `name = "openhelm-goose"`, 2 vCPU / 4 GB RAM; linked to `Dockerfile`
- **`e2b/build.sh`** — build script: copies `agent/mcp-servers/` into E2B build context, runs `e2b template build`, cleans up; prints post-build instructions for setting `E2B_TEMPLATE_ID` in Fly.io secrets
- **`e2b/.env.example`** — documents `E2B_API_KEY` and `E2B_TEMPLATE_ID` variables
- **`worker/src/executor.ts`** — now writes per-run MCP config (`/tmp/mcp-config.json`) to the sandbox before launching Goose; passes `--mcp-config /tmp/mcp-config.json` flag; sets `GOOSE_PROVIDER`, `GOOSE_MODEL`, `GOOSE_LEAD_MODEL`, and `ANTHROPIC_API_KEY` env vars per-sandbox

### Added (Plan 12, Phases 4–5: Hosted Cloud Deployment)

#### Phase 4: Worker Service
- **`worker/`** — new standalone Node.js service deployed on Fly.io that drives cloud-mode execution
  - `src/scheduler.ts` — 60-second tick loop; queries Supabase for due jobs across all users, enforces per-user concurrency limits, creates run records
  - `src/executor.ts` — E2B sandbox lifecycle: clones project git URL, writes prompt, runs Goose agent, streams output, tears down sandbox on completion
  - `src/stream-relay.ts` — bridges E2B sandbox stdout to Supabase Realtime Broadcast (`run:{runId}` channel) with 5-second batch persistence to `run_logs`
  - `src/llm-router.ts` — direct Anthropic API for chat/planning/assessment (bypasses E2B for operations that don't need file system access)
  - `src/usage-meter.ts` + `src/cost-calculator.ts` — token billing at 20% markup over Anthropic raw rates; normalizes to Haiku-equivalent credits; atomically updates subscription via `increment_used_credits` RPC
  - `src/index.ts` — health endpoint (`GET /health`), action RPC endpoint (`POST /rpc`), crash recovery on startup
  - `Dockerfile` + `fly.toml` — production-ready Fly.io deployment config (London region, shared-cpu-1x, always-on)
- **`supabase/migrations/20260406000004_rpc_functions.sql`** — `increment_used_credits` and `get_usage_summary` Postgres functions with tightly scoped permissions

#### Phase 5: Frontend Transport Layer
- **`src/lib/mode.ts`** — `isLocalMode` / `isCloudMode` flags; detects Tauri vs browser context
- **`src/lib/transport.ts`** — `Transport` interface + lazy singleton `TransportProxy`; all data flows through `transport.request()` and `transport.onEvent()`
- **`src/lib/transport-tauri.ts`** — `TauriTransport` wraps existing `agentClient`; local mode is unchanged
- **`src/lib/transport-supabase.ts`** — `SupabaseTransport` for cloud mode; CRUD via PostgREST, actions via Worker HTTP RPC, events via Supabase Realtime Broadcast
- **`src/lib/transport-supabase-crud.ts`** — full PostgREST dispatch table (projects, goals, jobs, runs, settings, memories, inbox, etc.)
- **`src/lib/supabase-client.ts`** — Supabase anon client singleton; reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
- **`src/components/auth/auth-guard.tsx`** — transparent in local mode; requires Supabase auth in cloud mode; shows `LoginPage` until authenticated
- **`src/components/auth/login-page.tsx`** — email/password, Google OAuth, magic link authentication UI (no external auth-ui library dependency)
- **`src/lib/api.ts`** — migrated from `agentClient.request()` to `transport.request()` (150 call sites, mechanical replace)
- **`src/hooks/use-agent-event.ts`** — migrated to `transport.onEvent()` for cross-mode event subscriptions
- **`src/main.tsx`** — wrapped `<App>` with `<AuthGuard>`; cloud mode enforces auth before rendering
- **`src/App.tsx`** — cloud mode skips `agentClient.start()`; sets `agentReady` immediately (AuthGuard already confirmed session)
- **`@supabase/supabase-js`** added to root `package.json`

## [0.8.0] - 2026-04-05

### Added
- **Unified page headers with search & filter**: New shared `PageHeader` and `FilterBar` components provide consistent search/filter UI across Data Tables, Memory, Credentials, and Inbox pages
- **Data Tables project labels**: Each table card now shows which project it belongs to when viewing "All Projects"
- **Data Tables search & project filter**: Search tables by name/description and filter by project
- **Inbox search & category filter**: Search events by title/body and filter by category (Runs, Alerts, Actions, etc.)
- **Credentials search**: Text search across credential names

### Fixed
- **Stuck unfired investigation jobs + leftover "AutoCaptain" branding**: Some investigation jobs were created with `next_fire_at = NULL` (likely a race condition during scanner spawn) and never fired. Migration 0038 archives these stuck jobs (the scanner will re-spawn if the breach persists) and rewrites persisted "AutoCaptain"/"Captain Rules"/"Captain Metrics" strings to their new "Autopilot" names across job descriptions/prompts, data table descriptions, inbox items, and inbox events. Also updated the `Captain scan:` inbox event title and stale `AutoCaptain` comments in source.
- **Completed investigation jobs cluttering Autopilot Maintenance goal**: One-shot `Investigate: X` jobs were disabled by the scheduler after firing but never archived, piling up as "paused" clutter (90+ per project over a few days). Post-run handler now archives them immediately after creating the dashboard insight. Migration 0036 cleans up existing ones by archiving any `captain_investigation` job that has a terminal run; unfired jobs are left alone so the scheduler can still fire them.
- **Duplicate Autopilot Maintenance goals**: A bug in the autopilot scanner caused a new "Autopilot Maintenance" system goal (with a "Health Rules Review" job) to be created every 30 minutes per project, resulting in hundreds of duplicate goals and jobs. Added migration 0035 that automatically deduplicates on upgrade (keeps the oldest goal per project, deletes duplicates and their orphaned jobs/targets/runs). Added a unique partial index to prevent recurrence at the database level. Also fixed `CreateGoalParams` missing `icon` field.
- **CDP connection lost after auto_login**: Form submission triggers page navigation, but `auto_login()` returned immediately without waiting for the page to load. The next tool call would hit a stale CDP tab mid-navigation and incorrectly report "Browser CDP connection lost". Now waits for `LoadEventFired` (up to 15s) plus 1s settle time after form submit.
- **get_tab CDP validation too aggressive during navigation**: The 5-second `tab.evaluate("1")` probe would timeout during active page navigation (e.g. after login redirect) and permanently mark the browser as errored. Now retries up to 3 times with increasing timeouts (5s/8s/11s) to handle transient navigation states. Hard connection errors (socket refused) still fail immediately.
- **auto_login selectors miss common sites**: Default username selectors now include `input[name="acct"]` (Hacker News), `input[name="user"]`, and password selector includes `input[name="pw"]` (HN).
- **check_session hangs on unresponsive browser**: `check_session_cookies()` CDP calls now have a 10-second timeout. Returns a clear error message instead of hanging until the 60s tool timeout.
- **Inbox zoom slider UX**: Replaced inline zoom label with a centered mini-toast that appears on zoom changes. Slider now snaps to discrete tier stops only, preventing empty zoom levels with no events. Slider is hidden when only one tier exists.
- **Historic events not appearing in Inbox**: Fixed backfill guard that skipped historic run/alert backfill when any inbox events already existed. Backfill now runs with deduplication (versioned key `inbox_backfill_v2`).
- **Chat thread messages shown verbatim in Inbox**: Side-panel chat conversations now display as a summary card (thread name + last updated time) instead of raw message content.
- **Now button stuck visible / wrong arrow direction**: Now button immediately hides when clicked, and arrow flips to point up when user has scrolled past Now into the future.
- **Reply arrow on wrong side**: Moved the reply-on-hover button from left to right side of inbox events.

### Changed
- **Nautical-themed input placeholders**: Both inbox and chat panel input fields now show random nautical/ship-themed placeholder text instead of generic "Message your AI assistant...".

### Fixed
- **Credentials not injected for corrective (retry) runs**: When a run failed and triggered a corrective retry, the entire credential injection block was skipped because the resume path assumed the parent session still had credentials. Since MCP servers are respawned fresh, browser credentials were never written, causing all credential-dependent corrective runs to fail with "credentials not available". Credentials are now always resolved regardless of resume path.
- **Agent appears hung after macOS sleep/wake**: The heartbeat mechanism declared the agent dead after a single missed ping (10s timeout). After macOS sleep/wake or CPU spikes, the agent can be transiently slow. Now requires 3 consecutive heartbeat failures before declaring the agent unresponsive. Additionally, a recovery probe now periodically pings the agent after it is declared hung — if the agent becomes responsive again, the UI auto-recovers without requiring an app restart.
- **Browser MCP CDP connection validation**: The browser MCP's `get_tab()` now validates the CDP connection is alive before returning the tab reference. When the connection has dropped (e.g. browser crash, macOS sleep), it raises a clear error message telling the agent to spawn a new browser instead of failing deep inside a tool operation.

### Added
- **Persistent browser profiles**: Named Chrome profiles (`~/.openhelm/profiles/`) for session reuse across automation runs
  - New `profile_manager.py` module with CRUD, locking, and session cookie checking
  - `spawn_browser(profile="name")` parameter auto-creates and locks profiles
  - `check_session(instance_id, domain)` verifies login status via known auth cookies
  - Profile locks prevent Chrome conflicts when concurrent tasks share profiles
  - `list_profiles` and `create_profile` MCP tools for profile management
- **Behavioral variance injection**: Human-like interaction patterns to avoid bot detection
  - New `behavior.py` module with Bezier mouse paths, humanized click/type delays, scroll jitter
  - `humanize` parameter on `click_element` and `type_text` (default True)
  - Truncated normal distribution for delays (not uniform — humans cluster around the mean)
  - Deterministic mode via `OPENHELM_DETERMINISTIC=1` for test stability
- **Browser session setup flow**: Post-save credential UX for one-time manual login
  - "Browser only" credentials now offer to open Chrome for manual login after saving
  - Sessions persist in named profiles, reused automatically in future automation runs
  - Credentials remain saved for scope switching (env var, prompt modes)
- **Profile-aware task queuing**: Executor skips queue items whose browser profiles are locked
  - Tasks wait in queue until the required profile is freed, then run automatically
  - `browserProfileName` column on credentials table links profiles to credentials
  - Profile locks released on run completion, failure, or agent restart
- **MCP system prompt**: Claude now uses persistent profiles and checks session validity automatically
- **Intervention section**: Renamed MCP `captcha` section to `intervention` (covers CAPTCHAs + re-auth prompts)
  - `request_user_help` docstring updated to include session re-authentication use case
  - `--disable-captcha` flag kept as backwards-compatible alias for `--disable-intervention`
- **Inbox page**: New unified event timeline replacing Dashboard Alerts & Actions section
  - Vertical scrolling timeline of all OpenHelm events (runs, alerts, AI messages, data/memory/credential changes, scheduled jobs)
  - Importance-based tiering (0-100 scale) with dynamic tier grouping via natural-break algorithm
  - Zoom between detail levels via tier slider or pinch-to-zoom gesture (ctrl+scroll)
  - Master chat input for messaging the AI directly from the Inbox timeline
  - Inline reply to any event in the timeline
  - Future events section showing scheduled job runs
  - Smooth Framer Motion animations for tier zoom transitions
- Inbox is now the default landing page (Dashboard retains System + Insights sections)
- New `inbox_events` database table (migration 0033) for event storage
- Centralized inbox event bridge converts IPC events to timeline events automatically
- Programmatic importance scoring with contextual modifiers (no LLM required)
- Dedicated inbox conversation channel (separate from sidebar chat threads)

## [0.7.1] - 2026-04-03

### Fixed
- Browser cleanup: Chrome instances spawned by openhelm-browser MCP were not being killed after job runs completed, accumulating in the macOS Dock
  - `find_pid_on_port` was using `lsof -ti :PORT` which returned the Python MCP server PID (CDP client) instead of the Chrome PID (CDP server); fixed to use `lsof -t -i TCP:PORT -sTCP:LISTEN`
  - Agent-side cleanup now scans for orphaned nodriver Chrome processes (by `uc_*` temp dir pattern) as a fallback when PID tracking fails
  - Python MCP server shutdown cleanup now also scans for orphaned nodriver Chrome processes instead of relying solely on tracked PIDs

## [0.7.0] - 2026-04-02

### Added
- Autopilot autonomous overhaul: significantly enhanced autopilot system to operate more independently with improved goal planning and execution
- New scanner module for intelligent goal discovery and analysis
- New metrics module for tracking autopilot performance and outcomes
- Post-run assessment system for evaluating job results

### Changed
- Bump safe npm dependencies: `@sentry/react` + `@sentry/node` 10.46→10.47, `posthog-js` 1.364.3→1.364.4, and OpenTelemetry transitive updates
- Bump Rust crates: `hyper` 1.8.1→1.9.0, `wasm-bindgen` 0.2.116→0.2.117, `js-sys`/`web-sys` 0.3.93→0.3.94, and related updates

### Security
- Reject non-absolute file paths in `data.export`, `data.importPreview`, and `data.importExecute` IPC handlers to prevent path traversal attacks via the dev bridge

## [0.6.1] - 2026-04-02

### Fixed
- Sentry OPENHELM-14/15: goal.children crash on drag-and-drop
- Various bug fixes and stability improvements

### Changed
- Sidebar UX improvements and other minor enhancements

## [0.6.0] - 2026-04-01

### Added
- Goal hierarchy: support for parent-child goal relationships with cascading status updates
- Chat tools for targets: AI chat can now list, retrieve, and evaluate targets within conversations
- Chat tools for visualizations: AI chat can now suggest and manage data table visualizations
- Enhanced system prompt: improved formatting and capabilities for target evaluation and visualization suggestions

### Changed
- Bump safe npm dependencies: `@sentry/react` + `@sentry/node` 10.46→10.47, `posthog-js` 1.364.3→1.364.4
- Bump Rust crates: `hyper` 1.8.1→1.9.0, `wasm-bindgen` 0.2.116→0.2.117, and related transitive updates

### Fixed
- Chat streaming deduplication: chunks shorter than accumulated text were incorrectly re-emitted, potentially doubling words in the output; fixed by using `totalStreamedText.startsWith(stripped)` to reliably detect already-emitted subsets

## [0.5.3] - 2026-04-01

### Fixed
- Data table chart creation: filter out empty column/data entries before rendering to prevent Radix validation errors
- Sentry noise: suppress expected "message already being processed" errors (user-triggered double-send race, handled in UI)
- Sentry noise: suppress spurious events from OS-level pipe teardown on sidecar exit
- AppShell: guard `startDragging()` call behind Tauri internals check to prevent crashes in dev bridge HTTP context
- Chat improvements: better error handling and UX enhancements

## [Unreleased]

### Security
- Reject non-absolute file paths in `data.export`, `data.importPreview`, and `data.importExecute` IPC handlers to prevent path traversal attacks via the dev bridge

### Fixed
- Chat streaming deduplication: chunks shorter than accumulated text were incorrectly re-emitted, potentially doubling words in the output; fixed by using `totalStreamedText.startsWith(stripped)` to reliably detect already-emitted subsets

### Changed
- Bump safe npm dependencies: `@sentry/react` + `@sentry/node` 10.45→10.46, `posthog-js` 1.364.1→1.364.3, `rollup` + `@rollup/rollup-darwin-arm64` 4.60.0→4.60.1, `vitest` 4.1.1→4.1.2
- Bump safe npm dependencies: `@sentry/react` + `@sentry/node` 10.46→10.47, `posthog-js` 1.364.3→1.364.4, plus OpenTelemetry instrumentation transitive updates
- Bump Rust crates: `tao` 0.34.6→0.34.8, `wry` 0.54.2→0.54.4, `darling` 0.21→0.23, `serde_with` 3.17→3.18, `time` 0.3.45→0.3.47, `wasm-bindgen` 0.2.114→0.2.116, plus numerous other compatible updates
- Bump Rust crates: `hyper` 1.8.1→1.9.0, `wasm-bindgen` 0.2.116→0.2.117, `js-sys`/`web-sys` 0.3.93→0.3.94, `serde_spanned` 1.1.0→1.1.1, `toml_*` patch updates

## [0.5.2] - 2026-04-01

### Added
- Chat data table tools: the AI chat sidebar can now CRUD data tables (list, get, create, insert rows, update rows, delete) — previously only available during job runs via MCP

### Fixed
- Chat AI correctly uses XML tools for OpenHelm data queries (goals, jobs, data tables) instead of native Bash/Agent tools; achieved via `--disallowed-tools Bash,Agent` + `--allowed-tools` whitelist
- Tool loop session resumption no longer crashes when first call used `--no-session-persistence`; each iteration now independently starts a fresh Claude Code session
- Chat streaming text no longer runs sentences together when tool calls are stripped or across tool-loop iterations
- Thread delete button now available even when only one thread remains

## [0.5.1] - 2026-03-31

### Fixed
- Test fixes: improved test coverage and stability
- Minor improvements: performance and stability enhancements

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

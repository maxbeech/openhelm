# /deploy-cloud — Deploy OpenHelm Hosted Cloud to Production

Deploys all cloud services to production: E2B (if changed) → Worker (Fly.io) → Frontend (Vercel).
Runs pre-flight checks, deploys in the correct order, and verifies health.

## Usage
```
/deploy-cloud          # Deploy all services (auto-detects E2B changes)
/deploy-cloud worker   # Worker only (skips E2B and frontend)
/deploy-cloud frontend # Frontend only (skips E2B and worker)
/deploy-cloud e2b      # E2B template rebuild only
```

---

## Steps to execute

### 0. Determine scope

If an argument was given:
- `worker` → run steps 1 and 4 only
- `frontend` → run step 3 only
- `e2b` → run step 2 only (force rebuild regardless of changes)
- No argument → run all steps in order (E2B only if changes detected)

Tell the user what is about to be deployed and confirm: "Deploying <scope> to production — shall I proceed?"

---

### 1. Check for E2B changes (full deploy only)

Skip this step if a specific service argument was given.

The E2B sandbox template must be rebuilt whenever `e2b/` or `agent/mcp-servers/` changes
(`agent/mcp-servers/` is copied into the Docker build context by `e2b/build.sh`).

#### 1a. Check for uncommitted changes in E2B paths

```bash
git diff --name-only HEAD -- e2b/ agent/mcp-servers/
```

If any files are listed, set `E2B_NEEDS_REBUILD=true` and note: "Uncommitted changes detected in E2B paths."

#### 1b. Check for commits since last tag that touched E2B paths

```bash
git log $(git describe --tags --abbrev=0)..HEAD --oneline -- e2b/ agent/mcp-servers/
```

If any commits are listed, set `E2B_NEEDS_REBUILD=true` and note the commit messages.

#### 1c. Decide

- If `E2B_NEEDS_REBUILD=true`: tell the user "E2B changes detected — will rebuild sandbox template before deploying worker." Then proceed to step 2.
- If no changes: tell the user "No E2B changes detected — skipping sandbox rebuild." Skip to step 3.

---

### 2. Rebuild E2B Sandbox Template

**Only run this step if E2B changes were detected (step 1) or the `e2b` argument was given.**

The build takes several minutes. The script copies `agent/mcp-servers/` into the Docker context,
runs `e2b template build`, then cleans up.

#### 2a. Run the build script

```bash
./e2b/build.sh
```

Wait for it to complete. The output will print a new Template ID, e.g.:
```
Template ID: abc123xyz
```

Capture the new Template ID from the output.

If the build fails, stop entirely. Do not deploy the worker with a broken or outdated sandbox template.

#### 2b. Update the Fly.io secret

Set the new template ID on the worker so it uses the freshly built sandbox:

```bash
fly secrets set E2B_TEMPLATE_ID=<new-template-id> --app openhelm-worker
```

#### 2c. Update e2b.toml for documentation

Edit `e2b/e2b.toml` — update `template_id` to the new value so the repo stays in sync:

```toml
template_id = "<new-template-id>"
```

Commit this change:

```bash
git add e2b/e2b.toml
git commit -m "chore: update E2B template ID to <new-template-id>"
```

---

### 3. Deploy Worker Service → Fly.io

**App:** `openhelm-worker`  
**Config:** `worker/fly.toml`  
**Strategy:** rolling deploy (zero-downtime)

#### 3a. Check working tree

```bash
git diff --name-only HEAD -- worker/
```

If there are uncommitted changes in `worker/`, warn the user: "There are uncommitted changes in worker/ — these will NOT be included in the Docker build because Fly builds from the filesystem. Commit them first or proceed knowing the deploy will use the current files."

#### 3b. Deploy

Run from the repo root (fly.toml references `worker/Dockerfile`):

```bash
fly deploy --config worker/fly.toml
```

This builds the Docker image, pushes it to Fly's registry, and does a rolling deploy. Wait for it to complete before proceeding.

If the deploy fails, show the last 30 lines of output and stop. Do not proceed to the frontend deploy.

#### 3c. Verify health

```bash
curl -sf https://openhelm-worker.fly.dev/health
```

Expect a 200 response. If it fails, stop and report the error — do not deploy the frontend if the worker is unhealthy.

---

### 4. Deploy Frontend → Vercel

**Output dir:** `dist/`  
**Build command:** `npx tsc -p shared/tsconfig.json && npx vite build`

#### 4a. Build check (dry run)

Run the build locally to catch errors before Vercel does:

```bash
npx tsc -p shared/tsconfig.json --noEmit && npx vite build
```

If this fails, stop and show the error. Do not push a broken build to production.

#### 4b. Deploy to Vercel

```bash
npx vercel --prod
```

Wait for completion. Vercel will print the production URL when done.

#### 4c. Verify deployment

```bash
curl -sf -o /dev/null -w "%{http_code}" https://app.openhelm.ai
```

Expect a 200. If not, report the status code.

---

### 5. Post-deploy summary

Report the following once all steps complete:

- **E2B**: rebuilt (new template ID) or skipped
- **Worker**: `https://openhelm-worker.fly.dev` — health check status
- **Frontend**: `https://app.openhelm.ai` — HTTP status
- **Fly.io dashboard**: `https://fly.io/apps/openhelm-worker`
- Any warnings or things to manually verify

---

## Troubleshooting Reference

**E2B build fails:**
- Ensure E2B CLI is installed: `npm install -g @e2b/cli`
- Ensure authenticated: `e2b auth login`
- Check `agent/mcp-servers/` exists and is intact

**Worker deploy fails:**
```bash
fly logs --app openhelm-worker
```

**Worker health check fails after deploy:**
```bash
fly status --app openhelm-worker
fly logs --app openhelm-worker --instance <id>
```

**Vercel build fails:**
- Check TypeScript errors in `shared/` — the `tsc` step runs first
- Required Vercel env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WORKER_URL`, `VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY`

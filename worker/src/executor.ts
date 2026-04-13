/**
 * Worker Executor — manages E2B sandbox lifecycle for cloud-mode runs.
 *
 * Per-run flow:
 *  1. Create E2B sandbox from pre-built openhelm-goose template
 *  2. Clone project git URL into /workspace
 *  3. Write per-run MCP config to /tmp/mcp-config.json
 *  4. Write prompt to /tmp/prompt.txt (avoids ARG_MAX)
 *  5. Execute Goose agent with MCP config, streaming stdout via StreamRelay
 *  6. Update run status and record token usage on completion
 *  7. Kill sandbox (teardown)
 */

import Sandbox from "e2b";
import { getSupabase } from "./supabase.js";
import { config } from "./config.js";
import { createStreamRelay } from "./stream-relay.js";
import { meterRunUsage } from "./usage-meter.js";
import {
  hydrateBrowserProfiles,
  type HydratedProfile,
} from "./profile-hydration.js";

/** In-memory map of runId → active Sandbox instance (for cancellation). */
const activeSandboxes = new Map<string, InstanceType<typeof Sandbox>>();

// ── MCP config ──────────────────────────────────────────────────────────────

/**
 * Build the Goose-compatible MCP config JSON for a sandbox run.
 *
 * All MCP servers are pre-installed in the sandbox image at
 * /opt/openhelm/mcp-servers/. Paths here match the Dockerfile. If the run has
 * hydrated browser profiles, the first one is passed to the MCP so Chromium
 * reuses its saved cookies / local storage. Chromium runs against the desktop
 * image's real XFCE display — no --headless flag.
 */
function buildMcpConfig(profiles: HydratedProfile[] = []): string {
  const primaryProfile = profiles[0]?.profileDir;
  const cfg = {
    mcpServers: {
      "openhelm-browser": {
        command: "/opt/openhelm/mcp-servers/browser/.venv/bin/python",
        args: [
          "/opt/openhelm/mcp-servers/browser/src/server.py",
          "--transport",
          "stdio",
        ],
        cwd: "/opt/openhelm/mcp-servers/browser",
        env: {
          CHROMIUM_FLAGS: "--no-sandbox --disable-gpu",
          ...(primaryProfile
            ? { OPENHELM_BROWSER_PROFILE_DIR: primaryProfile }
            : {}),
        },
      },
    },
  };
  return JSON.stringify(cfg, null, 2);
}

// ── Executor ─────────────────────────────────────────────────────────────────

export async function executeRun(runId: string): Promise<void> {
  const supabase = getSupabase();

  // Fetch the run and its job/project
  const { data: run, error: runErr } = await supabase
    .from("runs")
    .select("id, user_id, job_id")
    .eq("id", runId)
    .single();
  if (runErr || !run) {
    console.error(`[executor] run ${runId} not found:`, runErr?.message);
    return;
  }

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id, user_id, project_id, prompt, model, silence_timeout_minutes")
    .eq("id", run.job_id)
    .single();
  if (jobErr || !job) {
    console.error(`[executor] job for run ${runId} not found:`, jobErr?.message);
    await markRunFailed(runId, "Job record not found");
    return;
  }

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id, git_url")
    .eq("id", job.project_id)
    .single();
  if (projErr || !project?.git_url) {
    console.error(`[executor] project git_url missing for run ${runId}`);
    await markRunFailed(runId, "Project git URL is required for cloud runs");
    return;
  }

  // Mark run as running
  await supabase.from("runs").update({
    status: "running",
    started_at: new Date().toISOString(),
  }).eq("id", runId);

  const relay = createStreamRelay(runId);

  try {
    const timeoutMs = job.silence_timeout_minutes
      ? job.silence_timeout_minutes * 60_000
      : config.sandboxTimeoutMs;

    // Resolve model from job config or default to GPT-4o via OpenRouter
    const model = (job.model as string | null) ?? "openai/gpt-4o";

    const sandbox = await Sandbox.create(config.e2bTemplateId, {
      timeoutMs,
      envs: {
        // Goose routes through OpenRouter — all OpenAI-compatible models available
        GOOSE_PROVIDER: "openrouter",
        GOOSE_MODEL: model,
        GOOSE_LEAD_PROVIDER: "openrouter",
        GOOSE_LEAD_MODEL: model,
        OPENROUTER_API_KEY: config.openrouterApiKey,
      },
    });
    activeSandboxes.set(runId, sandbox);

    // Clone project repository
    relay.onStderr(`[openhelm] cloning ${project.git_url}`);
    await sandbox.commands.run(`git clone --depth 1 "${project.git_url}" /workspace`, {
      timeoutMs: 120_000,
    });

    // Hydrate any persisted browser profiles for credentials in scope
    const hydratedProfiles = await hydrateBrowserProfiles(
      sandbox,
      {
        userId: run.user_id as string,
        projectId: job.project_id as string,
        jobId: job.id as string,
      },
      (line) => relay.onStderr(line),
    );

    // Write per-run MCP config (passes hydrated profile path via env)
    relay.onStderr("[openhelm] writing MCP config");
    await sandbox.files.write("/tmp/mcp-config.json", buildMcpConfig(hydratedProfiles));

    // Write prompt to file (avoids stdin complexity with E2B commands API)
    await sandbox.files.write("/tmp/prompt.txt", job.prompt);

    // Run Goose agent, streaming output in real-time
    relay.onStderr("[openhelm] starting Goose agent");
    const result = await sandbox.commands.run(
      `bash -c 'cd /workspace && goose run --output-format stream-json --mcp-config /tmp/mcp-config.json --no-session < /tmp/prompt.txt'`,
      {
        timeoutMs,
        onStdout: (line) => relay.onStdout(line),
        onStderr: (line) => relay.onStderr(line),
      },
    );

    await relay.flush();
    await sandbox.kill();
    activeSandboxes.delete(runId);

    const succeeded = result.exitCode === 0;
    await supabase.from("runs").update({
      status: succeeded ? "succeeded" : "failed",
      exit_code: result.exitCode,
      finished_at: new Date().toISOString(),
      summary: succeeded ? "Run completed successfully." : `Exited with code ${result.exitCode}.`,
    }).eq("id", runId);

    // Record token usage from stream-json events (totalTokens extracted by stream parser in meter)
    if (succeeded) {
      await meterRunUsage(run.user_id as string, runId, model);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[executor] run ${runId} failed:`, msg);
    relay.onStderr(`[openhelm] run error: ${msg}`);
    await relay.flush();
    relay.cleanup();
    activeSandboxes.delete(runId);
    await markRunFailed(runId, msg);
  } finally {
    relay.cleanup();
  }
}

/** Cancel a running sandbox by runId. */
export async function cancelRun(runId: string): Promise<void> {
  const sandbox = activeSandboxes.get(runId);
  if (!sandbox) {
    console.error(`[executor] cancelRun: no active sandbox for ${runId}`);
    return;
  }
  await sandbox.kill();
  activeSandboxes.delete(runId);
  await getSupabase()
    .from("runs")
    .update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("id", runId);
  console.error(`[executor] cancelled run ${runId}`);
}

async function markRunFailed(runId: string, reason: string): Promise<void> {
  await getSupabase()
    .from("runs")
    .update({
      status: "failed",
      summary: reason,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

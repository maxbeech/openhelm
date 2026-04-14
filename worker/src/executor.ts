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

import { Sandbox } from "e2b";
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
 * Build the Goose `--with-extension` argument string for the openhelm-browser
 * stdio MCP server. Goose's flag takes a single string of the form:
 *   "ENV1=val1 ENV2=val2 /path/to/command arg1 arg2 ..."
 * See https://github.com/block/goose `goose-cli/src/cli.rs` (`ExtensionOptions`).
 *
 * Environment variables that don't vary per-run (CHROMIUM_FLAGS) are passed
 * via the sandbox's process env on Sandbox.create() instead, so this string
 * stays simple and safe to shell-quote. The per-run profile dir, when set,
 * is included here via an env-var prefix so it is scoped to the MCP process.
 *
 * All MCP servers are pre-installed in the sandbox image at
 * /opt/openhelm/mcp-servers/. Paths here match e2b/Dockerfile.
 */
const BROWSER_MCP_WRAPPER_PATH = "/tmp/openhelm-browser";
const BROWSER_MCP_WRAPPER_SCRIPT = `#!/bin/bash
# OpenHelm browser MCP wrapper. This exists so goose's --with-extension flag
# labels the extension "openhelm-browser" (first token of the command)
# instead of "python3_12", and so any tool calls agents emit line up with
# the prompt conventions the local-mode MCP uses. The venv's 'python' stub
# is a 52KB ENOEXEC launcher on this E2B template; we invoke python3.12 via
# the venv symlink which resolves to /usr/bin/python3.12 while still
# picking up the venv's site-packages via pyvenv.cfg.
exec /opt/openhelm/mcp-servers/browser/.venv/bin/python3.12 \\
  /opt/openhelm/mcp-servers/browser/src/server.py --transport stdio "$@"
`;

function buildBrowserExtensionArg(profiles: HydratedProfile[] = []): string {
  const primaryProfile = profiles[0]?.profileDir;
  const envPrefix = primaryProfile
    ? `OPENHELM_BROWSER_PROFILE_DIR=${primaryProfile} `
    : "";
  return `${envPrefix}${BROWSER_MCP_WRAPPER_PATH}`;
}

/**
 * Shell-quote a single argument for bash -c. Uses single quotes and escapes
 * embedded single quotes with the standard '\'' pattern.
 */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Translate a local-mode model tier alias ("sonnet" / "haiku" / "opus") to
 * the OpenRouter-qualified model ID. A value that already contains a slash
 * is assumed to be an OpenRouter ID and returned as-is. Null / unknown falls
 * back to the default cloud execution model.
 */
const OPENROUTER_MODEL_MAP: Record<string, string> = {
  sonnet: "anthropic/claude-sonnet-4.6",
  "sonnet-4.6": "anthropic/claude-sonnet-4.6",
  haiku: "anthropic/claude-haiku-4.5",
  "haiku-4.5": "anthropic/claude-haiku-4.5",
  opus: "anthropic/claude-opus-4.6",
  "opus-4.6": "anthropic/claude-opus-4.6",
};
const DEFAULT_CLOUD_MODEL = "anthropic/claude-sonnet-4.6";

export function resolveOpenRouterModel(model: string | null | undefined): string {
  if (!model) return DEFAULT_CLOUD_MODEL;
  if (model.includes("/")) return model;
  return OPENROUTER_MODEL_MAP[model] ?? DEFAULT_CLOUD_MODEL;
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

  const relay = createStreamRelay(runId, run.user_id as string);

  try {
    const timeoutMs = job.silence_timeout_minutes
      ? job.silence_timeout_minutes * 60_000
      : config.sandboxTimeoutMs;

    // Resolve model from job config. Jobs are stored with local-mode tier
    // aliases ("sonnet", "haiku", "opus") that Claude Code understands; for
    // cloud mode we route through OpenRouter which requires fully-qualified
    // model IDs. Map the tier aliases here and pass anything else through
    // as-is (so users can configure a specific OpenRouter model later).
    const model = resolveOpenRouterModel(job.model as string | null | undefined);

    const sandbox = await Sandbox.create(config.e2bTemplateId, {
      timeoutMs,
      envs: {
        // Goose routes through OpenRouter — all OpenAI-compatible models available
        GOOSE_PROVIDER: "openrouter",
        GOOSE_MODEL: model,
        GOOSE_LEAD_PROVIDER: "openrouter",
        GOOSE_LEAD_MODEL: model,
        OPENROUTER_API_KEY: config.openrouterApiKey,
        // Inherited by the openhelm-browser MCP process so Chromium launches
        // inside the sandbox without needing suid namespaces.
        CHROMIUM_FLAGS: "--no-sandbox --disable-gpu",
      },
    });
    activeSandboxes.set(runId, sandbox);

    // Clone project repository. Use /tmp/workspace to avoid any ownership
    // or pre-existing contents in the /workspace WORKDIR. Capture stdout/
    // stderr so a clone failure surfaces a useful error message in run_logs
    // instead of a bare "exit status 1".
    relay.onStderr(`[openhelm] cloning ${project.git_url}`);
    const cloneResult = await sandbox.commands.run(
      `rm -rf /tmp/workspace && git clone --depth 1 "${project.git_url}" /tmp/workspace`,
      {
        timeoutMs: 120_000,
        onStdout: (line: string) => relay.onStdout(line),
        onStderr: (line: string) => relay.onStderr(line),
      },
    );
    if (cloneResult.exitCode !== 0) {
      throw new Error(
        `git clone failed (exit ${cloneResult.exitCode}): ${cloneResult.stderr?.slice(0, 500) ?? ""}`,
      );
    }

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

    // Write prompt to file — passed to goose via -i (instructions file),
    // which is more robust than redirecting stdin through bash.
    await sandbox.files.write("/tmp/prompt.txt", job.prompt);

    // Install the openhelm-browser wrapper script so goose labels the
    // extension correctly and agents see `openhelm_browser__*` tool names
    // (matching local-mode prompt conventions) rather than `python3_12__*`.
    await sandbox.files.write(BROWSER_MCP_WRAPPER_PATH, BROWSER_MCP_WRAPPER_SCRIPT);
    await sandbox.commands.run(`chmod +x ${BROWSER_MCP_WRAPPER_PATH}`, {
      timeoutMs: 5_000,
    });

    // Build the goose --with-extension argument. Goose does NOT have a
    // --mcp-config flag; stdio MCP servers are attached via --with-extension.
    const browserExtArg = buildBrowserExtensionArg(hydratedProfiles);
    relay.onStderr(
      `[openhelm] attaching MCP extensions: openhelm-browser` +
        (hydratedProfiles.length > 0
          ? ` (profile=${hydratedProfiles[0]?.profileDir})`
          : ""),
    );

    // Run Goose agent, streaming output in real-time. `--with-builtin developer`
    // gives goose its standard shell/file tools for exploring the cloned repo.
    relay.onStderr("[openhelm] starting Goose agent");
    const gooseCmd =
      `cd /tmp/workspace && goose run ` +
      `--output-format stream-json --no-session ` +
      `--with-builtin developer ` +
      `--with-extension ${shq(browserExtArg)} ` +
      `-i /tmp/prompt.txt`;
    const result = await sandbox.commands.run(`bash -c ${shq(gooseCmd)}`, {
      timeoutMs,
      onStdout: (line) => relay.onStdout(line),
      onStderr: (line) => relay.onStderr(line),
    });

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

/**
 * Executor — consumes runs from the job queue and manages the Claude Code
 * process lifecycle. Default concurrency is 1 (configurable up to 3).
 *
 * Core invariant: the run is marked "running" in the database BEFORE the
 * Claude Code process is spawned. This prevents orphaned processes on crash.
 *
 * Log ordering: DB insert BEFORE IPC emit, so historical view matches live view.
 */

import { existsSync } from "fs";
import { jobQueue, type QueueItem } from "../scheduler/queue.js";
import {
  runClaudeCode,
  type RunnerConfig,
} from "../claude-code/runner.js";
import { updateRun, getRun, listRuns, snapshotRunCorrectionNote } from "../db/queries/runs.js";
import {
  getJob,
  updateJobNextFireAt,
  updateJobCorrectionNote,
  disableJob,
} from "../db/queries/jobs.js";
import { attemptSelfCorrection, type FailureSignal } from "./self-correction.js";
import { triagePermanentFailure } from "./failure-triage.js";
import { handleInteractiveDetected } from "./hitl-handler.js";
import { createDashboardItem } from "../db/queries/dashboard-items.js";
import { getProject } from "../db/queries/projects.js";
import { createRunLog } from "../db/queries/run-logs.js";
import { getSetting, deleteSetting } from "../db/queries/settings.js";
import { computeNextFireAt } from "../scheduler/schedule.js";
import { emit } from "../ipc/emitter.js";
import { generateRunSummary } from "../planner/summarize.js";
import { assessOutcome, type OutcomeAssessment } from "../planner/outcome-assessor.js";
import { evaluateCorrectionNote } from "../planner/correction-evaluator.js";
import { extractMemoriesFromRun } from "../memory/run-extractor.js";
import { retrieveMemories } from "../memory/retriever.js";
import { buildMemorySection } from "../memory/prompt-builder.js";
import { saveRunMemories } from "../db/queries/memories.js";
import { countProjectRuns } from "../db/queries/runs.js";
import { resolveCredentialsForJob, touchCredential, saveRunCredentials, type RunCredentialEntry } from "../db/queries/credentials.js";
import { getKeychainItem } from "../keychain/index.js";
import { createRedactor, extractSecretStrings } from "../credentials/redactor.js";
import type { InteractiveDetectionType } from "../claude-code/interactive-detector.js";
import type { RunStatus, ClaudeCodeRunResult, Job, Credential, CredentialValue } from "@openhelm/shared";
import { captureAgentError, addAgentBreadcrumb } from "../sentry.js";
import {
  isPowerManagementEnabled,
  onRunStarted,
  onRunFinished,
  scheduleWake,
} from "../power/index.js";
import { InterventionWatcher, cleanupOrphanedInterventions } from "./intervention-watcher.js";
import { isAuthError, handleAuthFailure } from "./auth-monitor.js";
import { isMcpError, handleMcpFailure } from "./mcp-monitor.js";
import { handleAutopilotRunCompleted } from "../autopilot/post-run.js";

const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_TIMEOUT_MS = 0; // No limit (silence timeout catches stuck processes)

/** Function signature matching runClaudeCode (for dependency injection in tests) */
type RunnerFn = (
  config: RunnerConfig,
  signal?: AbortSignal,
) => Promise<ClaudeCodeRunResult>;

export class Executor {
  private activeRuns = new Map<string, AbortController>();
  private hitlKilledRuns = new Map<string, InteractiveDetectionType>();
  /** Tracks which browser profile paths are in use by running tasks. */
  private profileLocks = new Map<string, string>(); // profileName → runId
  private runnerFn: RunnerFn;

  constructor(runnerFn?: RunnerFn) {
    this.runnerFn = runnerFn ?? runClaudeCode;
  }

  get activeRunCount(): number {
    return this.activeRuns.size;
  }

  get maxConcurrency(): number {
    const setting = getSetting("max_concurrent_runs");
    const value = setting ? parseInt(setting.value, 10) : DEFAULT_MAX_CONCURRENCY;
    return Math.max(1, Math.min(5, isNaN(value) ? DEFAULT_MAX_CONCURRENCY : value));
  }

  /** Try to dequeue and execute the next run if under concurrency limit */
  processNext(): void {
    // Don't start new runs when the scheduler is paused — leave items in the
    // queue so they execute once the user resumes.
    if (getSetting("scheduler_paused")?.value === "true") return;

    if (this.activeRuns.size >= this.maxConcurrency) return;

    // Profile-aware dequeue: skip items whose browser credentials require a
    // profile that is currently locked by another running task.
    const item = jobQueue.dequeueWhere((candidate) => {
      const profiles = this.getRequiredProfiles(candidate.jobId);
      if (profiles.length === 0) return true; // no profile needed — eligible
      return profiles.every((p) => !this.profileLocks.has(p));
    });
    if (!item) return;

    // Lock any profiles this run needs
    const profiles = this.getRequiredProfiles(item.jobId);
    for (const p of profiles) {
      this.profileLocks.set(p, item.runId);
    }

    // Fire and forget — the async execution manages its own lifecycle
    this.executeRun(item).catch((err) => {
      console.error(`[executor] unexpected error in executeRun:`, err);
      captureAgentError(err, { runId: item.runId, jobId: item.jobId });
      // Release the active-run slot and profile locks
      this.activeRuns.delete(item.runId);
      this.releaseProfileLocks(item.runId);
      try {
        const current = getRun(item.runId);
        if (current?.status === "running") {
          const finishedAt = new Date().toISOString();
          updateRun({ id: item.runId, status: "failed", finishedAt });
          createRunLog({
            runId: item.runId,
            stream: "stderr",
            text: "Run failed due to an internal executor error.",
          });
          emit("run.statusChanged", {
            runId: item.runId,
            status: "failed",
            previousStatus: "running",
            finishedAt,
            exitCode: null,
          });
        }
      } catch (cleanupErr) {
        console.error(`[executor] cleanup failed for run ${item.runId}:`, cleanupErr);
      }
    });
  }

  /**
   * Get browser profile names required by a job's credentials.
   * Returns empty array if no browser-only credentials have profiles.
   */
  private getRequiredProfiles(jobId: string): string[] {
    try {
      const creds = resolveCredentialsForJob(jobId);
      return creds
        .filter((c) => c.allowBrowserInjection && c.browserProfileName)
        .map((c) => c.browserProfileName!)
        .filter((v, i, a) => a.indexOf(v) === i); // dedupe
    } catch {
      return [];
    }
  }

  /** Release all profile locks held by a run. */
  private releaseProfileLocks(runId: string): void {
    for (const [profile, lockRunId] of this.profileLocks) {
      if (lockRunId === runId) {
        this.profileLocks.delete(profile);
      }
    }
  }

  /** Cancel a run — removes from queue or aborts the process */
  cancelRun(runId: string): boolean {
    // Check if it's in the queue
    if (jobQueue.remove(runId)) {
      updateRun({ id: runId, status: "cancelled" });
      emit("run.statusChanged", {
        runId,
        status: "cancelled",
        previousStatus: "queued",
      });
      return true;
    }

    // Check if it's currently running — delete first to prevent double-cancel if called again
    const controller = this.activeRuns.get(runId);
    if (controller) {
      this.activeRuns.delete(runId);
      controller.abort();
      if (isPowerManagementEnabled()) {
        onRunFinished();
      }
      return true;
    }

    return false;
  }

  /** Stop the executor and cancel all active runs */
  stopAll(): void {
    for (const [runId, controller] of this.activeRuns) {
      console.error(`[executor] stopping active run ${runId}`);
      controller.abort();
    }
  }

  /** Recover from agent crash or update restart on startup */
  recoverFromCrash(): void {
    // Clean up orphaned intervention files from previous crashes
    cleanupOrphanedInterventions();

    // Check if this restart was caused by a planned app update
    const updatePending = getSetting("update_pending");
    const isUpdateRestart = updatePending?.value === "true";
    if (isUpdateRestart) {
      deleteSetting("update_pending");
      console.error("[executor] detected update restart — will re-enqueue interrupted runs");
    }

    // Handle stuck "running" runs
    const stuckRuns = listRuns({ status: "running", limit: 100 });
    for (const run of stuckRuns) {
      if (isUpdateRestart) {
        // Update restart: re-enqueue the run so it retries automatically
        console.error(`[executor] re-enqueuing update-interrupted run ${run.id}`);
        updateRun({
          id: run.id,
          status: "queued",
        });
        createRunLog({
          runId: run.id,
          stream: "stderr",
          text: "Run interrupted by app update. Automatically re-enqueued.",
        });
        const priority = run.triggerSource === "manual" ? 0
          : run.triggerSource === "corrective" ? 2 : 1;
        jobQueue.enqueue({
          runId: run.id,
          jobId: run.jobId,
          priority,
          enqueuedAt: Date.now(),
        });
        emit("run.statusChanged", {
          runId: run.id,
          status: "queued",
          previousStatus: "running",
        });
      } else {
        // Crash: mark as failed (existing behaviour)
        console.error(`[executor] recovering stuck run ${run.id} → failed`);
        updateRun({
          id: run.id,
          status: "failed",
          finishedAt: new Date().toISOString(),
        });
        createRunLog({
          runId: run.id,
          stream: "stderr",
          text: "Run interrupted by agent restart. The process was lost.",
        });
        emit("run.statusChanged", {
          runId: run.id,
          status: "failed",
          previousStatus: "running",
        });
      }
    }

    // Re-enqueue "queued" runs (same for both crash and update)
    const queuedRuns = listRuns({ status: "queued", limit: 100 });
    for (const run of queuedRuns) {
      // Skip runs already enqueued above (update-interrupted runs)
      if (jobQueue.has(run.id)) continue;
      console.error(`[executor] re-enqueuing run ${run.id}`);
      const priority = run.triggerSource === "manual" ? 0
        : run.triggerSource === "corrective" ? 2 : 1;
      jobQueue.enqueue({
        runId: run.id,
        jobId: run.jobId,
        priority,
        enqueuedAt: Date.now(),
      });
    }

    const reEnqueued = isUpdateRestart ? stuckRuns.length : 0;
    const failed = isUpdateRestart ? 0 : stuckRuns.length;
    if (stuckRuns.length > 0 || queuedRuns.length > 0) {
      console.error(
        `[executor] recovery: ${failed} failed, ${reEnqueued + queuedRuns.length} re-enqueued` +
        (isUpdateRestart ? " (update restart)" : " (crash)"),
      );
    }
  }

  /** Execute a single run through its full lifecycle */
  private async executeRun(item: QueueItem): Promise<void> {
    const { runId, jobId } = item;

    console.error(`[executor] starting run ${runId} for job ${jobId}`);

    // Pre-flight: load job, project, check prerequisites
    const preflight = this.preflightCheck(runId, jobId);
    if (!preflight) return;
    const { job, project, claudePath, timeoutMs } = preflight;

    // Register AbortController BEFORE marking the run as running, so there is
    // never a window where the run is "running" in the DB but has no handle.
    const controller = new AbortController();
    this.activeRuns.set(runId, controller);

    // Mark running BEFORE spawning (critical ordering invariant)
    const startedAt = new Date().toISOString();
    updateRun({ id: runId, status: "running", startedAt });
    emit("run.statusChanged", {
      runId,
      status: "running",
      previousStatus: "queued",
      startedAt,
    });

    // Prevent idle sleep while this run is active
    if (isPowerManagementEnabled()) {
      onRunStarted();
    }

    // Start watching for CAPTCHA intervention requests from browser MCP
    const interventionWatcher = new InterventionWatcher(runId, jobId, job.projectId);
    interventionWatcher.start();

    // Determine if this is a resumable corrective run
    const run = getRun(runId);
    let parentSessionId: string | null = null;
    if (run?.triggerSource === "corrective" && run.parentRunId) {
      const parentRun = getRun(run.parentRunId);
      parentSessionId = parentRun?.sessionId ?? null;
    }
    const isResumable = parentSessionId !== null;

    // Build effective prompt based on execution path
    let effectivePrompt: string;
    let resumeSessionId: string | undefined;

    if (isResumable) {
      // Resume path: use the run's correctionNote (continuation prompt) as the message,
      // and resume the parent's session. Skip memory injection (session has context).
      effectivePrompt = run!.correctionNote ?? job.prompt;
      resumeSessionId = parentSessionId!;
      console.error(`[executor] resume path: resuming session ${resumeSessionId} for corrective run ${runId}`);
    } else {
      // Fresh path: build full prompt with job.prompt + correctionNote + memories
      if (job.correctionNote) {
        snapshotRunCorrectionNote(runId, job.correctionNote);
      }
      effectivePrompt = job.prompt;

      // Inject global prompt (applies to all jobs; user-configurable in Settings)
      const globalPromptSetting = getSetting("global_prompt");
      if (globalPromptSetting?.value) {
        effectivePrompt += `\n\n---\n\nGeneral Guidelines:\n${globalPromptSetting.value}`;
      }

      if (job.correctionNote) {
        effectivePrompt += `\n\n---\n\nCorrection Note (from a previous run failure — may no longer apply):\n${job.correctionNote}\n\nAddress these issues if still relevant.`;
      }

      // Build a richer retrieval query combining job metadata + prompt content.
      // Used by both memory retrieval and data table retrieval below.
      const retrievalQuery = [
        `Job: ${job.name}`,
        job.description ? `Description: ${job.description}` : null,
        job.correctionNote ? `Correction: ${job.correctionNote}` : null,
        effectivePrompt.slice(0, 300),
      ].filter(Boolean).join("\n");

      // Inject relevant memories into prompt
      try {
        const scored = await retrieveMemories({
          projectId: job.projectId,
          goalId: job.goalId ?? undefined,
          jobId: job.id,
          query: retrievalQuery,
        });
        if (scored.length > 0) {
          effectivePrompt += buildMemorySection(scored);
          saveRunMemories(runId, scored.map((s) => s.memory.id));
          console.error(`[executor] injected ${scored.length} memories into run ${runId}`);
        }
      } catch (err) {
        console.error("[executor] memory retrieval error (non-fatal):", err);
      }

      // Inject relevant data table schemas into prompt
      try {
        const { retrieveRelevantTables } = await import("../data-tables/retriever.js");
        const { buildDataTableSection } = await import("../data-tables/prompt-builder.js");
        const relevantTables = await retrieveRelevantTables({
          projectId: job.projectId,
          query: retrievalQuery,
        });
        if (relevantTables.length > 0) {
          effectivePrompt += buildDataTableSection(relevantTables);
          console.error(`[executor] injected ${relevantTables.length} table schemas into run ${runId}`);
        }
      } catch (err) {
        console.error("[executor] data table retrieval error (non-fatal):", err);
      }

      // Inject target progress into prompt
      try {
        const { listTargets } = await import("../db/queries/targets.js");
        const { buildTargetSection } = await import("../data-tables/target-prompt-builder.js");
        const jobTargets = listTargets({ jobId: job.id });
        const goalTargets = job.goalId ? listTargets({ goalId: job.goalId }) : [];
        // Deduplicate by id in case a target is somehow associated with both
        const allTargets = [...new Map([...jobTargets, ...goalTargets].map((t) => [t.id, t])).values()];
        if (allTargets.length > 0) {
          effectivePrompt += buildTargetSection(allTargets);
          console.error(`[executor] injected ${allTargets.length} targets into run ${runId}`);
        }
      } catch (err) {
        console.error("[executor] target injection error (non-fatal):", err);
      }
    }

    // ── Credential injection ──
    // Credentials are ALWAYS resolved (even for resumed corrective runs) because
    // MCP servers are respawned fresh and need the browser credentials file.
    // Only the prompt-level hints are skipped for resumed sessions (the parent
    // session context already contains them).
    const additionalEnv: Record<string, string> = {};
    const credentialAudit: RunCredentialEntry[] = [];
    const allSecrets: string[] = [];
    let browserCredentialsFilePath: string | undefined;

    try {
      const applicableCreds = resolveCredentialsForJob(jobId);
      const credentialHints: string[] = [];
      const browserCredentialHints: string[] = [];
      const browserCredentials: import("../credentials/browser-credentials.js").BrowserCredential[] = [];

      for (const cred of applicableCreds) {
        let raw: string | null = null;
        try {
          raw = await getKeychainItem(cred.id);
        } catch (err) {
          console.error(`[executor] keychain read failed for credential "${cred.name}" (non-fatal):`, err);
          continue;
        }
        if (!raw) continue;

        let value: CredentialValue;
        try {
          value = JSON.parse(raw) as CredentialValue;
        } catch (err) {
          // Malformed JSON in keychain (e.g. raw token stored by hand) — skip
          // this credential rather than aborting all subsequent ones.
          console.error(`[executor] credential "${cred.name}" has non-JSON keychain value (skipping):`, err);
          continue;
        }
        // Always add to redactor (catches leaks in logs regardless of injection mode)
        allSecrets.push(...extractSecretStrings(value));

        if (cred.allowBrowserInjection) {
          // Browser-only injection — NO env var, NO prompt
          if (value.type === "username_password") {
            browserCredentials.push({
              name: cred.name,
              type: "username_password",
              username: value.username,
              password: value.password,
            });
            browserCredentialHints.push(
              `- "${cred.name}" (username_password) — use auto_login`,
            );
          } else {
            browserCredentials.push({
              name: cred.name,
              type: "token",
              value: value.value,
            });
            browserCredentialHints.push(
              `- "${cred.name}" (token) — use inject_auth_cookie or inject_auth_header`,
            );
          }
          credentialAudit.push({ credentialId: cred.id, injectionMethod: "browser" });
        } else {
          // Env injection (default)
          if (value.type === "username_password") {
            additionalEnv[cred.envVarName + "_USERNAME"] = value.username;
            additionalEnv[cred.envVarName + "_PASSWORD"] = value.password;
            credentialHints.push(
              `- $${cred.envVarName}_USERNAME / $${cred.envVarName}_PASSWORD — "${cred.name}" (username & password)`,
            );
          } else {
            additionalEnv[cred.envVarName] = value.value;
            credentialHints.push(`- $${cred.envVarName} — "${cred.name}" (token)`);
          }
          credentialAudit.push({ credentialId: cred.id, injectionMethod: "env" });

          // Optionally also inject value into prompt context
          if (!isResumable && cred.allowPromptInjection) {
            const valueStr = value.type === "username_password"
              ? `Username: ${value.username}, Password: ${value.password}`
              : value.value;
            effectivePrompt += `\n\n---\n\nCredential "${cred.name}": ${valueStr}`;
            credentialAudit.push({ credentialId: cred.id, injectionMethod: "prompt" });
          }
        }

        touchCredential(cred.id);
      }

      // Append credential hints to prompt (skip for resumed sessions — parent has them)
      if (!isResumable) {
        if (credentialHints.length > 0) {
          effectivePrompt +=
            `\n\n---\n\nAvailable Credentials (set as environment variables — use in shell commands):\n` +
            credentialHints.join("\n");
        }
        if (browserCredentialHints.length > 0) {
          effectivePrompt +=
            `\n\n---\n\nBrowser credentials available (use browser MCP tools — values are pre-loaded securely):\n` +
            browserCredentialHints.join("\n");
        }
      }

      // Write browser credentials to temp file for MCP server (always — MCP is respawned)
      if (browserCredentials.length > 0) {
        try {
          const { writeBrowserCredentialsFile } = await import("../credentials/browser-credentials.js");
          browserCredentialsFilePath = writeBrowserCredentialsFile(runId, browserCredentials);
          console.error(`[executor] browser credentials file written for run ${runId}`);
        } catch (err) {
          console.error("[executor] browser credentials file write error (non-fatal):", err);
        }
      }

      const totalCreds = credentialHints.length + browserCredentialHints.length;
      if (totalCreds > 0) {
        console.error(`[executor] injected ${totalCreds} credentials into run ${runId} (${browserCredentials.length} browser-only)`);
      }
    } catch (err) {
      console.error("[executor] credential resolution error (non-fatal):", err);
    }

    // Create redactor for log output
    const redact = createRedactor(allSecrets);

    // ── MCP config (bundled browser + data tables servers) ──
    let mcpConfigPath: string | undefined;
    let hasBrowserMcp = false;
    try {
      const { isVenvReady, isSourceAvailable, setupBrowserMcpVenv } =
        await import("../mcp-servers/browser-setup.js");
      if (isVenvReady()) {
        hasBrowserMcp = true;
      } else if (isSourceAvailable()) {
        // Auto-setup the browser MCP venv on first run when source is bundled
        console.error("[executor] browser MCP source available but venv not ready — setting up...");
        try {
          await setupBrowserMcpVenv();
          hasBrowserMcp = true;
          console.error("[executor] browser MCP venv setup complete");
        } catch (setupErr) {
          console.error("[executor] browser MCP auto-setup failed (non-fatal):", setupErr);
        }
      }
    } catch { /* browser setup not available — non-fatal */ }

    try {
      // Write MCP config with bundled servers (openhelm-browser + openhelm-data).
      // Passed via --mcp-config to ADD on top of the user's existing MCP environment.
      const { writeMcpConfigFile } = await import("../mcp-servers/mcp-config-builder.js");
      mcpConfigPath = writeMcpConfigFile(runId, hasBrowserMcp ? browserCredentialsFilePath : undefined, job.projectId) ?? undefined;
      if (mcpConfigPath) {
        console.error(`[executor] MCP config written for run ${runId}`);
      }
    } catch (err) {
      console.error("[executor] MCP config generation error (non-fatal):", err);
    }

    // Prepend MCP preambles and build system prompt additions
    let appendSystemPrompt: string | undefined;
    if (mcpConfigPath) {
      const { BROWSER_MCP_PREAMBLE, BROWSER_CAPTCHA_PREAMBLE, BROWSER_CREDENTIALS_PREAMBLE, BROWSER_PROFILE_PREAMBLE, DATA_TABLES_MCP_PREAMBLE, BROWSER_SYSTEM_PROMPT } = await import("../mcp-servers/mcp-config-builder.js");
      // Data tables preamble (always available when MCP config exists)
      effectivePrompt = DATA_TABLES_MCP_PREAMBLE + effectivePrompt;
      // Browser MCP preamble + system prompt (only when browser venv is ready)
      if (hasBrowserMcp) {
        effectivePrompt = BROWSER_MCP_PREAMBLE + BROWSER_CAPTCHA_PREAMBLE + BROWSER_PROFILE_PREAMBLE + effectivePrompt;
        // System-level instruction is far more authoritative than user-prompt preamble
        appendSystemPrompt = BROWSER_SYSTEM_PROMPT;
        if (browserCredentialsFilePath) {
          effectivePrompt = BROWSER_CREDENTIALS_PREAMBLE + effectivePrompt;
        }
      }
    }

    // Track the Claude Code process PID so the focus guard can suppress child windows.
    let claudePid: number | undefined;

    // Accumulate recent stderr lines for post-mortem analysis (auth/MCP detection)
    const recentStderr: string[] = [];

    // Execute via ClaudeCodeRunner
    const result = await this.runnerFn(
      {
        binaryPath: claudePath,
        workingDirectory: job.workingDirectory ?? project.directoryPath,
        prompt: effectivePrompt,
        timeoutMs,
        silenceTimeoutMs: job.silenceTimeoutMinutes
          ? job.silenceTimeoutMinutes * 60_000
          : undefined,
        model: job.model ?? undefined,
        modelEffort: (job.modelEffort as "low" | "medium" | "high") ?? undefined,
        permissionMode: (job.permissionMode as "default" | "acceptEdits" | "dontAsk" | "bypassPermissions") ?? undefined,
        resumeSessionId,
        additionalEnv: Object.keys(additionalEnv).length > 0 ? additionalEnv : undefined,
        mcpConfigPath,
        appendSystemPrompt,
        onPidAvailable: (pid) => {
          claudePid = pid;
          // Notify the Tauri focus guard (intercepted in Rust before reaching the frontend)
          emit("focus_guard.addPid", { pid });
        },
        onLogChunk: (stream, text) => {
          // Redact any credential values from logs
          const safeText = redact(text);
          // DB insert BEFORE IPC emit (ordering invariant)
          const log = createRunLog({ runId, stream, text: safeText });
          emit("run.log", { runId, sequence: log.sequence, stream, text: safeText });
          // Accumulate recent stderr for post-mortem auth/MCP detection
          if (stream === "stderr") {
            recentStderr.push(safeText);
            if (recentStderr.length > 30) recentStderr.shift();
          }
        },
        onInteractiveDetected: (reason, type) => {
          emit("run.interactiveDetected", { runId, reason, type });
          this.hitlKilledRuns.set(runId, type);
          handleInteractiveDetected(runId, reason, controller);
        },
      },
      controller.signal,
    );

    // Release the focus guard for this process tree now that the run has finished.
    if (claudePid !== undefined) {
      emit("focus_guard.removePid", { pid: claudePid });
    }

    // Wrap all post-run cleanup in try/finally so the active-run slot is always
    // released even if an individual cleanup step throws unexpectedly.
    try {
      // Stop CAPTCHA intervention watcher and clean up any remaining files
      interventionWatcher.stop();

      // Clean up per-run MCP config file
      if (mcpConfigPath) {
        try {
          const { removeMcpConfigFile } = await import("../mcp-servers/mcp-config-builder.js");
          removeMcpConfigFile(mcpConfigPath);
        } catch { /* ignore */ }
      }

      // Clean up browser credentials file (defensive — MCP server should have already deleted it)
      if (browserCredentialsFilePath) {
        try {
          const { removeBrowserCredentialsFile } = await import("../credentials/browser-credentials.js");
          removeBrowserCredentialsFile(browserCredentialsFilePath);
        } catch { /* ignore */ }
      }

      // Kill any orphaned Chrome processes from this run (MCP server cleanup may not have completed)
      if (mcpConfigPath) {
        try {
          const { cleanupBrowsersForRun } = await import("../mcp-servers/browser-cleanup.js");
          cleanupBrowsersForRun(runId);
        } catch { /* ignore */ }
      }

      // Save credential audit trail
      if (credentialAudit.length > 0) {
        try {
          saveRunCredentials(runId, credentialAudit);
        } catch (err) {
          console.error("[executor] credential audit save error (non-fatal):", err);
        }
      }
    } finally {
      // Remove from active runs and release profile locks
      this.activeRuns.delete(runId);
      this.releaseProfileLocks(runId);
    }

    // Handle completion (includes async summary generation)
    await this.onRunCompleted(runId, job, result, timeoutMs, recentStderr);

    // Try to process the next item in the queue
    this.processNext();
  }

  /** Run pre-flight checks. Returns null if a check fails (run is marked accordingly). */
  private preflightCheck(runId: string, jobId: string) {
    const job = getJob(jobId);
    if (!job) {
      this.failPermanently(runId, "queued", `Job not found: ${jobId}`);
      return null;
    }

    const project = getProject(job.projectId);
    if (!project) {
      this.failPermanently(runId, "queued", `Project not found: ${job.projectId}`);
      return null;
    }

    const claudePathSetting = getSetting("claude_code_path");
    if (!claudePathSetting) {
      this.failPermanently(
        runId,
        "queued",
        "Claude Code CLI path is not configured. Go to Settings to set it up.",
      );
      return null;
    }

    if (!existsSync(claudePathSetting.value)) {
      this.failPermanently(
        runId,
        "queued",
        `Claude Code CLI not found at the configured path. It may have been moved or uninstalled. Update the path in Settings.`,
      );
      return null;
    }

    if (!existsSync(project.directoryPath)) {
      this.failPermanently(
        runId,
        "queued",
        `Project directory not found: ${project.directoryPath}. Check that the project directory still exists.`,
      );
      return null;
    }

    const timeoutSetting = getSetting("run_timeout_minutes");
    const parsedMinutes = timeoutSetting ? parseInt(timeoutSetting.value, 10) : NaN;
    const timeoutMs = !isNaN(parsedMinutes) && parsedMinutes > 0
      ? parsedMinutes * 60_000
      : DEFAULT_TIMEOUT_MS;

    return {
      job,
      project,
      claudePath: claudePathSetting.value,
      timeoutMs,
    };
  }

  /** Handle run completion: determine status, summarise, persist, emit events */
  private async onRunCompleted(
    runId: string,
    job: Job,
    result: ClaudeCodeRunResult,
    timeoutMs?: number,
    recentStderr?: string[],
  ): Promise<void> {
    // Release sleep prevention for this run
    if (isPowerManagementEnabled()) {
      onRunFinished();
    }

    const finishedAt = new Date().toISOString();

    // Check if this was a HITL kill and what type
    const hitlKillType = this.hitlKilledRuns.get(runId) ?? null;
    this.hitlKilledRuns.delete(runId);
    const isHitlKill = hitlKillType !== null;

    // Determine final status
    let finalStatus: RunStatus;
    let outcomeAssessment: OutcomeAssessment | null = null;
    if (result.killed && isHitlKill) {
      finalStatus = "failed";
    } else if (result.killed) {
      finalStatus = "cancelled";
    } else if (result.timedOut) {
      finalStatus = "failed";
      createRunLog({
        runId,
        stream: "stderr",
        text: "Run timed out. Process was terminated.",
      });
    } else if (result.exitCode === 0) {
      finalStatus = "succeeded";

      // Outcome verification: LLM checks if the mission was actually accomplished
      try {
        outcomeAssessment = await assessOutcome(runId, job.prompt);
        if (outcomeAssessment && !outcomeAssessment.accomplished && outcomeAssessment.confidence !== "low") {
          finalStatus = "failed";
          createRunLog({
            runId,
            stream: "stderr",
            text: `Mission not accomplished (${outcomeAssessment.confidence} confidence): ${outcomeAssessment.reason}`,
          });
        }
      } catch {
        // Assessment failure → keep "succeeded" (optimistic fallback)
      }
    } else {
      finalStatus = "failed";
    }

    // Generate AI summary BEFORE updating run — so the summary is present
    // in the DB when the statusChanged event reaches the UI
    const summary = await generateRunSummary(runId, finalStatus);

    // Update run status with summary, session ID, and token usage
    updateRun({
      id: runId,
      status: finalStatus,
      finishedAt,
      exitCode: result.exitCode ?? undefined,
      summary: summary ?? undefined,
      sessionId: result.sessionId ?? undefined,
      inputTokens: result.inputTokens ?? undefined,
      outputTokens: result.outputTokens ?? undefined,
    });

    console.error(`[executor] run ${runId} finished: ${finalStatus} (exit=${result.exitCode ?? "n/a"})`);
    emit("run.statusChanged", {
      runId,
      status: finalStatus,
      previousStatus: "running",
      summary,
      finishedAt,
      exitCode: result.exitCode,
      sessionId: result.sessionId ?? null,
    });
    emit("run.completed", {
      runId,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    });

    // Handle autopilot investigation completions (creates dashboard items)
    const run = getRun(runId);
    if (run) handleAutopilotRunCompleted(run);

    // Self-correction: attempt auto-retry for all failed runs
    // (silence timeouts are the only HITL kill type now — all are retryable)
    if (finalStatus === "failed") {
      addAgentBreadcrumb("run.failed", {
        runId,
        jobId: job.id,
        exitCode: result.exitCode ?? null,
      });

      // Check for auth/MCP failures from recent stderr (reactive detection)
      const stderrText = (recentStderr ?? []).join("\n");

      // Auth failure — skip self-correction entirely, pause scheduler
      if (isAuthError(stderrText)) {
        handleAuthFailure(runId, job.id, job.projectId);
        return;
      }

      // MCP failure — create alert but still allow self-correction
      if (isMcpError(stderrText)) {
        handleMcpFailure(runId, job.id, job.projectId, stderrText.slice(-300));
      }

      // Build structured failure signal
      const isTimeout = result.timedOut || result.exitCode === 143 || result.exitCode === 137;
      const isSilenceTimeout = hitlKillType === "silence_timeout";
      const mins = Math.round((timeoutMs ?? DEFAULT_TIMEOUT_MS) / 60_000);

      let failureContext: string | undefined;
      if (result.timedOut) {
        failureContext = `The run timed out after ${mins} minutes and was forcibly terminated. The task was likely partially completed. Check what was already done, skip completed steps, and use a more efficient approach.`;
      } else if (isSilenceTimeout) {
        failureContext = "The run was killed because Claude produced no output for an extended period (silence timeout). Claude may have gotten stuck on an interactive flow or unresponsive service. The run was otherwise productive before the stall.";
      } else if (result.exitCode === 143) {
        failureContext = `Process received SIGTERM (exit 143) — likely timed out or terminated externally. The task was likely partially completed.`;
      } else if (result.exitCode === 137) {
        failureContext = `Process was SIGKILL'd (exit 137) — possibly OOM or external force-kill. The task may have been partially completed.`;
      } else if (result.exitCode !== null && result.exitCode !== 0) {
        failureContext = `The run exited with code ${result.exitCode}.`;
      } else if (result.exitCode === 0 && outcomeAssessment && !outcomeAssessment.accomplished) {
        failureContext = `The run exited cleanly (exit code 0) but the mission was NOT accomplished: ${outcomeAssessment.reason}. The task may need a different approach, different credentials, or a workaround for blockers like anti-bot systems.`;
      }

      const failureSignal: FailureSignal = {
        isTimeout,
        isSilenceTimeout,
        exitCode: result.exitCode,
        timeoutMinutes: mins,
        failureContext,
      };

      attemptSelfCorrection(runId, job, (item) => {
        jobQueue.enqueue(item);
        this.processNext();
      }, failureSignal).then((scResult) => {
        if (scResult.attempted) {
          console.error(`[executor] self-correction: corrective run ${scResult.correctiveRunId} created (${scResult.reason})`);
        } else if (scResult.notFixable) {
          // Only promote to permanent_failure when LLM confirms not fixable
          triagePermanentFailure(runId, scResult.analysisReason ?? scResult.reason);
        } else if (scResult.analysisError) {
          // LLM failed but this is NOT "confirmed unfixable" — notify user, keep as "failed"
          console.error(`[executor] self-correction: LLM analysis failed, creating dashboard item`);
          const failedJob = getJob(job.id);
          if (failedJob) {
            const item = createDashboardItem({
              runId,
              jobId: failedJob.id,
              projectId: failedJob.projectId,
              type: "human_in_loop",
              title: `"${failedJob.name}" failed — auto-analysis unavailable`,
              message: scResult.reason,
            });
            emit("dashboard.created", item);
          }
        } else if (scResult.shouldTriage) {
          // Corrective run itself failed — escalate to permanent failure
          triagePermanentFailure(runId, scResult.reason);
        } else {
          console.error(`[executor] self-correction skipped: ${scResult.reason}`);
        }
      }).catch((err) => {
        console.error(`[executor] self-correction error:`, err);
        captureAgentError(err, { runId });
      });
    }

    // Evaluate correction note when any run succeeds with a note active
    if (finalStatus === "succeeded" && job.correctionNote) {
      evaluateCorrectionNote(runId, job.prompt, job.correctionNote)
        .then((evaluation) => {
          if (!evaluation) return; // LLM failed, keep note
          if (evaluation.action === "remove") {
            updateJobCorrectionNote(job.id, null);
          } else if (evaluation.action === "modify" && evaluation.modifiedNote) {
            updateJobCorrectionNote(job.id, evaluation.modifiedNote);
          }
          // "keep" = no-op
          if (evaluation.action !== "keep") {
            emit("job.updated", { jobId: job.id });
          }
        })
        .catch((err) => console.error(`[executor] correction evaluation error:`, err));
    }

    // Memory extraction: learn from completed runs (success or failure)
    extractMemoriesFromRun(runId, job).catch((err) =>
      console.error(`[executor] memory extraction error:`, err),
    );

    // Auto-prune memories every 10th completed run per project (decay + archive + consolidate)
    try {
      const completedCount = countProjectRuns(job.projectId);
      if (completedCount > 0 && completedCount % 10 === 0) {
        Promise.all([
          import("../memory/pruner.js").then(({ pruneProject }) => {
            const pruned = pruneProject(job.projectId);
            if (pruned > 0) {
              console.error(`[executor] auto-pruned ${pruned} memories for project ${job.projectId}`);
            }
          }),
          import("../memory/pruner.js").then(({ consolidateProject }) => {
            const merged = consolidateProject(job.projectId);
            if (merged > 0) {
              console.error(`[executor] auto-consolidated ${merged} duplicate memories for project ${job.projectId}`);
            }
          }),
        ]).catch((err) => console.error("[executor] auto-prune error (non-fatal):", err));
      }
    } catch (err) {
      console.error("[executor] auto-prune check error (non-fatal):", err);
    }

    // Update job's nextFireAt (regardless of outcome)
    this.updateNextFireTime(job, finishedAt);
  }

  /** Update nextFireAt based on schedule type after run completion */
  private updateNextFireTime(job: Job, finishedAt: string): void {
    if (job.scheduleType === "once") {
      disableJob(job.id);
      return;
    }

    if (job.scheduleType === "manual") {
      // Manual jobs never auto-fire; leave nextFireAt null without disabling
      updateJobNextFireAt(job.id, null);
      return;
    }

    // interval: compute from finish time; all others: from now
    const from =
      job.scheduleType === "interval" ? new Date(finishedAt) : new Date();
    const nextFireAt = computeNextFireAt(
      job.scheduleType,
      job.scheduleConfig,
      from,
    );

    // Sanity check: nextFireAt must be in the future
    if (nextFireAt && new Date(nextFireAt) <= new Date()) {
      console.error(
        `[executor] computed past nextFireAt for job ${job.id}, setting to null`,
      );
      updateJobNextFireAt(job.id, null);
      return;
    }

    updateJobNextFireAt(job.id, nextFireAt);

    // Schedule a wake event before the next occurrence
    if (isPowerManagementEnabled() && nextFireAt) {
      scheduleWake(job.id, new Date(nextFireAt)).catch((err) =>
        console.error("[executor] wake schedule error:", err),
      );
    }
  }

  /** Mark a run as permanent_failure with a log message + dashboard item */
  private failPermanently(
    runId: string,
    fromStatus: RunStatus,
    message: string,
  ): void {
    console.error(`[executor] permanent failure for run ${runId}: ${message}`);
    captureAgentError(new Error(message), { runId });
    updateRun({ id: runId, status: "permanent_failure" });
    createRunLog({ runId, stream: "stderr", text: message });
    emit("run.statusChanged", {
      runId,
      status: "permanent_failure",
      previousStatus: fromStatus,
    });

    // Create dashboard item for pre-flight failures
    const run = getRun(runId);
    if (run) {
      const job = getJob(run.jobId);
      if (job) {
        const item = createDashboardItem({
          runId,
          jobId: job.id,
          projectId: job.projectId,
          type: "permanent_failure",
          title: `"${job.name}" failed permanently`,
          message,
        });
        emit("dashboard.created", item);
      }
    }
  }
}

/** Singleton executor instance */
export const executor = new Executor();

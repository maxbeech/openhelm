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
import { createInboxItem } from "../db/queries/inbox-items.js";
import { getProject } from "../db/queries/projects.js";
import { createRunLog } from "../db/queries/run-logs.js";
import { getSetting, deleteSetting } from "../db/queries/settings.js";
import { computeNextFireAt } from "../scheduler/schedule.js";
import { emit } from "../ipc/emitter.js";
import { generateRunSummary } from "../planner/summarize.js";
import { evaluateCorrectionNote } from "../planner/correction-evaluator.js";
import { extractMemoriesFromRun } from "../memory/run-extractor.js";
import { retrieveMemories } from "../memory/retriever.js";
import { buildMemorySection } from "../memory/prompt-builder.js";
import { saveRunMemories } from "../db/queries/memories.js";
import type { InteractiveDetectionType } from "../claude-code/interactive-detector.js";
import type { RunStatus, ClaudeCodeRunResult, Job } from "@openhelm/shared";
import { captureAgentError, addAgentBreadcrumb } from "../sentry.js";
import {
  isPowerManagementEnabled,
  onRunStarted,
  onRunFinished,
  scheduleWake,
} from "../power/index.js";

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
    if (this.activeRuns.size >= this.maxConcurrency) return;

    const item = jobQueue.dequeue();
    if (!item) return;

    // Fire and forget — the async execution manages its own lifecycle
    this.executeRun(item).catch((err) => {
      console.error(`[executor] unexpected error in executeRun:`, err);
      captureAgentError(err, { runId: item.runId, jobId: item.jobId });
    });
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

    // Check if it's currently running
    const controller = this.activeRuns.get(runId);
    if (controller) {
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

    // Create abort controller for cancellation
    const controller = new AbortController();
    this.activeRuns.set(runId, controller);

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
      if (job.correctionNote) {
        effectivePrompt += `\n\n---\n\nCorrection Note (from a previous run failure — may no longer apply):\n${job.correctionNote}\n\nAddress these issues if still relevant.`;
      }

      // Inject relevant memories into prompt
      try {
        const scored = await retrieveMemories({
          projectId: job.projectId,
          goalId: job.goalId ?? undefined,
          jobId: job.id,
          query: effectivePrompt.slice(0, 500), // Use start of prompt as query
        });
        if (scored.length > 0) {
          effectivePrompt += buildMemorySection(scored);
          saveRunMemories(runId, scored.map((s) => s.memory.id));
          console.error(`[executor] injected ${scored.length} memories into run ${runId}`);
        }
      } catch (err) {
        console.error("[executor] memory retrieval error (non-fatal):", err);
      }
    }

    // Execute via ClaudeCodeRunner
    const result = await this.runnerFn(
      {
        binaryPath: claudePath,
        workingDirectory: job.workingDirectory ?? project.directoryPath,
        prompt: effectivePrompt,
        timeoutMs,
        model: job.model ?? undefined,
        modelEffort: (job.modelEffort as "low" | "medium" | "high") ?? undefined,
        permissionMode: (job.permissionMode as "default" | "acceptEdits" | "dontAsk" | "bypassPermissions") ?? undefined,
        resumeSessionId,
        onLogChunk: (stream, text) => {
          // DB insert BEFORE IPC emit (ordering invariant)
          const log = createRunLog({ runId, stream, text });
          emit("run.log", { runId, sequence: log.sequence, stream, text });
        },
        onInteractiveDetected: (reason, type) => {
          emit("run.interactiveDetected", { runId, reason, type });
          this.hitlKilledRuns.set(runId, type);
          handleInteractiveDetected(runId, reason, controller);
        },
      },
      controller.signal,
    );

    // Remove from active runs
    this.activeRuns.delete(runId);

    // Handle completion (includes async summary generation)
    await this.onRunCompleted(runId, job, result, timeoutMs);

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
    const timeoutMs = timeoutSetting
      ? parseInt(timeoutSetting.value, 10) * 60_000
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

    // Self-correction: attempt auto-retry for all failed runs
    // (silence timeouts are the only HITL kill type now — all are retryable)
    if (finalStatus === "failed") {
      addAgentBreadcrumb("run.failed", {
        runId,
        jobId: job.id,
        exitCode: result.exitCode ?? null,
      });
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
          console.error(`[executor] self-correction: LLM analysis failed, creating inbox item`);
          const failedJob = getJob(job.id);
          if (failedJob) {
            const item = createInboxItem({
              runId,
              jobId: failedJob.id,
              projectId: failedJob.projectId,
              type: "human_in_loop",
              title: `"${failedJob.name}" failed — auto-retry unavailable`,
              message: scResult.reason,
            });
            emit("inbox.created", item);
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

  /** Mark a run as permanent_failure with a log message + inbox item */
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

    // Create inbox item for pre-flight failures
    const run = getRun(runId);
    if (run) {
      const job = getJob(run.jobId);
      if (job) {
        const item = createInboxItem({
          runId,
          jobId: job.id,
          projectId: job.projectId,
          type: "permanent_failure",
          title: `"${job.name}" failed permanently`,
          message,
        });
        emit("inbox.created", item);
      }
    }
  }
}

/** Singleton executor instance */
export const executor = new Executor();

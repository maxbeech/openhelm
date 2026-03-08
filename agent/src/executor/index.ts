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
import { updateRun, getRun, listRuns } from "../db/queries/runs.js";
import {
  getJob,
  updateJobNextFireAt,
  disableJob,
} from "../db/queries/jobs.js";
import { getProject } from "../db/queries/projects.js";
import { createRunLog } from "../db/queries/run-logs.js";
import { getSetting } from "../db/queries/settings.js";
import { computeNextFireAt } from "../scheduler/schedule.js";
import { emit } from "../ipc/emitter.js";
import { generateRunSummary } from "../planner/summarize.js";
import type { RunStatus, ClaudeCodeRunResult } from "@openorchestra/shared";

const DEFAULT_MAX_CONCURRENCY = 1;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/** Function signature matching runClaudeCode (for dependency injection in tests) */
type RunnerFn = (
  config: RunnerConfig,
  signal?: AbortSignal,
) => Promise<ClaudeCodeRunResult>;

export class Executor {
  private activeRuns = new Map<string, AbortController>();
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
    return Math.max(1, Math.min(3, isNaN(value) ? DEFAULT_MAX_CONCURRENCY : value));
  }

  /** Try to dequeue and execute the next run if under concurrency limit */
  processNext(): void {
    if (this.activeRuns.size >= this.maxConcurrency) return;

    const item = jobQueue.dequeue();
    if (!item) return;

    // Fire and forget — the async execution manages its own lifecycle
    this.executeRun(item).catch((err) => {
      console.error(`[executor] unexpected error in executeRun:`, err);
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

  /** Recover from agent crash on startup */
  recoverFromCrash(): void {
    // Transition stuck "running" runs to "failed"
    const stuckRuns = listRuns({ status: "running", limit: 100 });
    for (const run of stuckRuns) {
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

    // Re-enqueue "queued" runs
    const queuedRuns = listRuns({ status: "queued", limit: 100 });
    for (const run of queuedRuns) {
      console.error(`[executor] re-enqueuing run ${run.id}`);
      const priority = run.triggerSource === "manual" ? 0 : 1;
      jobQueue.enqueue({
        runId: run.id,
        jobId: run.jobId,
        priority,
        enqueuedAt: Date.now(),
      });
    }

    if (stuckRuns.length > 0 || queuedRuns.length > 0) {
      console.error(
        `[executor] crash recovery: ${stuckRuns.length} failed, ${queuedRuns.length} re-enqueued`,
      );
    }
  }

  /** Execute a single run through its full lifecycle */
  private async executeRun(item: QueueItem): Promise<void> {
    const { runId, jobId } = item;

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
    });

    // Create abort controller for cancellation
    const controller = new AbortController();
    this.activeRuns.set(runId, controller);

    // Execute via ClaudeCodeRunner
    const result = await this.runnerFn(
      {
        binaryPath: claudePath,
        workingDirectory: job.workingDirectory ?? project.directoryPath,
        prompt: job.prompt,
        timeoutMs,
        onLogChunk: (stream, text) => {
          // DB insert BEFORE IPC emit (ordering invariant)
          const log = createRunLog({ runId, stream, text });
          emit("run.log", { runId, sequence: log.sequence, stream, text });
        },
        onInteractiveDetected: (reason) => {
          emit("run.interactiveDetected", { runId, reason });
        },
      },
      controller.signal,
    );

    // Remove from active runs
    this.activeRuns.delete(runId);

    // Handle completion (includes async summary generation)
    await this.onRunCompleted(runId, job, result);

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
    job: { id: string; scheduleType: string; scheduleConfig: unknown },
    result: ClaudeCodeRunResult,
  ): Promise<void> {
    const finishedAt = new Date().toISOString();

    // Determine final status
    let finalStatus: RunStatus;
    if (result.killed) {
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

    // Update run status with summary
    updateRun({
      id: runId,
      status: finalStatus,
      finishedAt,
      exitCode: result.exitCode,
      summary,
    });

    emit("run.statusChanged", {
      runId,
      status: finalStatus,
      previousStatus: "running",
      summary,
    });
    emit("run.completed", {
      runId,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    });

    // Update job's nextFireAt (regardless of outcome)
    this.updateNextFireTime(job, finishedAt);
  }

  /** Update nextFireAt based on schedule type after run completion */
  private updateNextFireTime(
    job: { id: string; scheduleType: string; scheduleConfig: unknown },
    finishedAt: string,
  ): void {
    if (job.scheduleType === "once") {
      disableJob(job.id);
      return;
    }

    const from =
      job.scheduleType === "interval" ? new Date(finishedAt) : new Date();
    const nextFireAt = computeNextFireAt(
      job.scheduleType as "interval" | "cron",
      job.scheduleConfig as { minutes: number } | { expression: string },
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
  }

  /** Mark a run as permanent_failure with a log message */
  private failPermanently(
    runId: string,
    fromStatus: RunStatus,
    message: string,
  ): void {
    console.error(`[executor] permanent failure for run ${runId}: ${message}`);
    updateRun({ id: runId, status: "permanent_failure" });
    createRunLog({ runId, stream: "stderr", text: message });
    emit("run.statusChanged", {
      runId,
      status: "permanent_failure",
      previousStatus: fromStatus,
    });
  }
}

/** Singleton executor instance */
export const executor = new Executor();

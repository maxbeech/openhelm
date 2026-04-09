import { registerHandler } from "../handler.js";
import { createRun } from "../../db/queries/runs.js";
import { getJob } from "../../db/queries/jobs.js";
import { getSetting, setSetting, deleteSetting } from "../../db/queries/settings.js";
import { jobQueue } from "../../scheduler/queue.js";
import { scheduler, enableLowTokenModeAndRecompute, disableLowTokenModeAndRecompute } from "../../scheduler/index.js";
import { nextWeeklyOccurrence } from "../../scheduler/schedule.js";
import { executor } from "../../executor/index.js";
import { emit } from "../emitter.js";
import type {
  TriggerRunParams,
  CancelRunParams,
  SchedulerStatus,
  PrepareForUpdateResult,
  SetLowTokenModeParams,
  SetLowTokenModeResult,
} from "@openhelm/shared";

export function registerSchedulerHandlers() {
  /**
   * Manually trigger a job run.
   * If fireAt is provided and in the future, creates a deferred run that the
   * scheduler will promote to "queued" when the time arrives.
   * Otherwise, creates a run with triggerSource="manual" and enqueues immediately
   * with priority 0 (highest priority — starts before scheduled runs).
   */
  registerHandler("runs.trigger", (params) => {
    const p = params as TriggerRunParams;
    if (!p?.jobId) throw new Error("jobId is required");

    const job = getJob(p.jobId);
    if (!job) throw new Error(`Job not found: ${p.jobId}`);

    // Deferred path: fireAt is set and is in the future
    if (p.fireAt && new Date(p.fireAt) > new Date()) {
      const run = createRun({
        jobId: p.jobId,
        triggerSource: "manual",
        status: "deferred",
        scheduledFor: p.fireAt,
      });

      emit("run.created", { runId: run.id, jobId: p.jobId });
      emit("run.statusChanged", {
        runId: run.id,
        status: "deferred",
        jobId: p.jobId,
      });

      return run;
    }

    // Immediate path: fire now
    // If parentRunId is provided, create a corrective run so the executor
    // can resume the parent's Claude Code session (if it has a sessionId).
    const run = p.parentRunId
      ? createRun({
          jobId: p.jobId,
          triggerSource: "corrective",
          parentRunId: p.parentRunId,
        })
      : createRun({ jobId: p.jobId, triggerSource: "manual" });

    jobQueue.enqueue({
      runId: run.id,
      jobId: p.jobId,
      priority: 0, // Manual = highest priority
      enqueuedAt: Date.now(),
    });

    emit("run.created", { runId: run.id, jobId: p.jobId });
    emit("run.statusChanged", {
      runId: run.id,
      status: "queued",
      jobId: p.jobId,
    });

    // Signal executor to check for work
    executor.processNext();

    return run;
  });

  /**
   * Force-execute a specific queued run immediately, bypassing the scheduler
   * pause. Used when the user clicks "Run Now Anyway" while paused.
   * The scheduler stays paused; only this run is executed right away.
   */
  registerHandler("runs.forceRun", (params) => {
    const p = params as { runId: string };
    if (!p?.runId) throw new Error("runId is required");
    const started = executor.forceRun(p.runId);
    return { started };
  });

  /**
   * Cancel a run.
   * If queued or deferred: removes from queue and marks cancelled.
   * If running: aborts the Claude Code process and marks cancelled.
   */
  registerHandler("runs.cancel", (params) => {
    const p = params as CancelRunParams;
    if (!p?.runId) throw new Error("runId is required");

    const cancelled = executor.cancelRun(p.runId);
    return { cancelled };
  });

  /**
   * Get current scheduler and executor status.
   */
  registerHandler("scheduler.status", () => {
    const paused = getSetting("scheduler_paused");
    const status: SchedulerStatus = {
      schedulerRunning: scheduler.running,
      paused: paused?.value === "true",
      tickIntervalMs: scheduler.tickIntervalMs,
      activeRuns: executor.activeRunCount,
      queuedRuns: jobQueue.size(),
      maxConcurrency: executor.maxConcurrency,
      lowTokenMode: getSetting("low_token_mode")?.value === "true",
    };
    return status;
  });

  /**
   * Pause the scheduler. Persists across restarts.
   * Does NOT stop currently running or queued runs.
   */
  registerHandler("scheduler.pause", () => {
    scheduler.stop();
    setSetting("scheduler_paused", "true");
    console.error("[scheduler] paused by user");
    emit("scheduler.statusChanged", { paused: true });
    return { paused: true };
  });

  /**
   * Resume the scheduler after a pause.
   */
  registerHandler("scheduler.resume", () => {
    deleteSetting("scheduler_paused");
    scheduler.start();
    console.error("[scheduler] resumed by user");
    emit("scheduler.statusChanged", { paused: false });
    // Drain any runs that were queued while paused — don't wait for next tick
    executor.processNext();
    return { paused: false };
  });

  /**
   * Enable or disable low token mode.
   * When enabled: all jobs run on Haiku, high-effort jobs run at medium effort,
   * and recurring job nextFireAt values are stretched by 1.5× (reducing frequency by ⅓).
   * Recomputes nextFireAt for all enabled recurring jobs immediately.
   */
  registerHandler("scheduler.setLowTokenMode", (params) => {
    const p = params as SetLowTokenModeParams;

    if (p.enabled) {
      enableLowTokenModeAndRecompute();
    } else {
      disableLowTokenModeAndRecompute();
    }

    // Compute next auto-reset time if weekly reset is configured
    let nextResetAt: string | null = null;
    if (p.enabled) {
      const dowSetting = getSetting("claude_weekly_reset_dow");
      const hourSetting = getSetting("claude_weekly_reset_hour");
      if (dowSetting && hourSetting) {
        const dow = parseInt(dowSetting.value, 10);
        const hour = parseInt(hourSetting.value, 10);
        if (!isNaN(dow) && !isNaN(hour)) {
          nextResetAt = nextWeeklyOccurrence(dow, hour, new Date()).toISOString();
        }
      }
    }

    const result: SetLowTokenModeResult = { enabled: p.enabled, nextResetAt };
    return result;
  });

  /**
   * Prepare the agent for an app update. Pauses the scheduler to prevent new
   * runs from being enqueued and sets an `update_pending` flag so that crash
   * recovery will re-enqueue interrupted runs instead of marking them failed.
   * Returns active/queued counts so the frontend can decide whether to wait.
   */
  registerHandler("executor.prepareForUpdate", () => {
    // Pause scheduler so no new runs are enqueued during the update
    scheduler.stop();
    // Set flag so crash recovery knows this was a planned update
    setSetting("update_pending", "true");
    console.error("[executor] prepared for update — scheduler paused, update_pending flag set");
    emit("scheduler.statusChanged", { paused: true });

    const result: PrepareForUpdateResult = {
      activeRuns: executor.activeRunCount,
      queuedRuns: jobQueue.size(),
      schedulerPaused: true,
    };
    return result;
  });

  /**
   * Cancel the update preparation (user clicked "Later" after preparing).
   * Clears the update_pending flag and resumes the scheduler if it wasn't
   * already paused by the user before the update check.
   */
  registerHandler("executor.cancelPrepareForUpdate", () => {
    deleteSetting("update_pending");
    // Resume scheduler only if user hadn't manually paused it
    const wasPaused = getSetting("scheduler_paused");
    if (wasPaused?.value !== "true") {
      scheduler.start();
      console.error("[executor] update cancelled — scheduler resumed");
      emit("scheduler.statusChanged", { paused: false });
    } else {
      console.error("[executor] update cancelled — scheduler stays paused (user-paused)");
    }
    return { ok: true };
  });

  /**
   * Stop all active runs and clear the queue.
   * Does NOT pause the scheduler — call scheduler.pause separately if needed.
   */
  registerHandler("executor.stopAll", () => {
    const queuedCount = jobQueue.size();
    const activeCount = executor.activeRunCount;
    jobQueue.clear();
    executor.stopAll();
    console.error(`[executor] stopAll: cleared ${queuedCount} queued, stopped ${activeCount} active`);
    emit("scheduler.statusChanged", {
      paused: getSetting("scheduler_paused")?.value === "true",
    });
    return { stoppedActive: activeCount, clearedQueued: queuedCount };
  });
}

/**
 * Scheduler — ticks every 60 seconds, enqueues due jobs.
 *
 * The scheduler has one job: query the database for enabled jobs whose
 * nextFireAt is in the past, create run records, enqueue them, and update
 * nextFireAt. It does NOT execute jobs or manage processes.
 *
 * Additionally, the scheduler promotes deferred runs whose scheduledFor
 * time has passed to "queued" and enqueues them.
 */

import { jobQueue } from "./queue.js";
import { computeNextFireAt } from "./schedule.js";
import { listDueJobs, updateJobNextFireAt, disableJob } from "../db/queries/jobs.js";
import { createRun, listDeferredDueRuns, listRuns, updateRun, getSystemTokenUsageForGoal, getUserTokenUsageForGoal } from "../db/queries/runs.js";
import { emit } from "../ipc/emitter.js";
import { createDashboardItem } from "../db/queries/dashboard-items.js";
import { isPowerManagementEnabled, scheduleWake } from "../power/index.js";
import { usageService } from "../usage/service.js";

const TICK_INTERVAL_MS = 60_000; // 1 minute
const USAGE_REFRESH_EVERY_N_TICKS = 5; // refresh usage every 5 minutes

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private _running = false;
  private onWorkEnqueued: (() => void) | null = null;
  private tickCount = 0;

  get running(): boolean {
    return this._running;
  }

  get tickIntervalMs(): number {
    return TICK_INTERVAL_MS;
  }

  /** Register a callback invoked after work is enqueued (notifies executor) */
  setOnWorkEnqueued(fn: () => void): void {
    this.onWorkEnqueued = fn;
  }

  /** Start the scheduler tick loop */
  start(): void {
    if (this._running) return;
    this._running = true;
    console.error("[scheduler] started, ticking every 60s");

    // Run an immediate tick, then start the interval
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  /** Stop the scheduler */
  stop(): void {
    if (!this._running) return;
    this._running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.error("[scheduler] stopped");
  }

  /**
   * Run a single scheduler tick.
   * Public for testability — tests call this directly without the timer.
   */
  tick(): void {
    try {
      let enqueued = 0;

      // ── 1. Enqueue due jobs (scheduled runs) ──
      const dueJobs = listDueJobs();
      for (const job of dueJobs) {
        // Budget guard for system jobs: skip if over 20% of goal's user token usage
        if (job.source === "system" && job.goalId) {
          const systemUsage = getSystemTokenUsageForGoal(job.goalId);
          const userUsage = getUserTokenUsageForGoal(job.goalId);
          // Only enforce budget if user jobs have meaningful usage (>1000 tokens)
          if (userUsage > 1000 && systemUsage > userUsage * 0.2) {
            console.error(
              `[scheduler] system job ${job.id} budget exceeded (${systemUsage}/${userUsage * 0.2}) — disabling`,
            );
            disableJob(job.id);
            const budgetItem = createDashboardItem({
              runId: null,
              jobId: job.id,
              projectId: job.projectId,
              type: "autopilot_limit",
              title: `System job "${job.name}" paused — token budget exceeded`,
              message: `System jobs for this goal have used ${systemUsage} tokens, exceeding 20% of user job usage (${userUsage} tokens). The job has been disabled.`,
            });
            emit("dashboard.created", budgetItem);
            continue;
          }
        }

        const run = createRun({
          jobId: job.id,
          triggerSource: "scheduled",
        });

        jobQueue.enqueue({
          runId: run.id,
          jobId: job.id,
          priority: 1,
          enqueuedAt: Date.now(),
        });

        const nextFireAt = computeNextFireAt(
          job.scheduleType,
          job.scheduleConfig,
          new Date(),
        );
        updateJobNextFireAt(job.id, nextFireAt);

        // Schedule a wake event before the next occurrence
        if (isPowerManagementEnabled() && nextFireAt) {
          scheduleWake(job.id, new Date(nextFireAt)).catch((err) =>
            console.error("[scheduler] wake schedule error:", err),
          );
        }

        emit("run.created", { runId: run.id, jobId: job.id });
        emit("run.statusChanged", {
          runId: run.id,
          status: "queued",
          jobId: job.id,
        });

        enqueued++;
      }

      if (dueJobs.length > 0) {
        console.error(`[scheduler] found ${dueJobs.length} due job(s)`);
      }

      // ── 2. Promote deferred runs whose time has come ──
      const deferredDue = listDeferredDueRuns();
      for (const run of deferredDue) {
        updateRun({ id: run.id, status: "queued" });

        jobQueue.enqueue({
          runId: run.id,
          jobId: run.jobId,
          priority: 0, // Manual priority (same as immediate trigger)
          enqueuedAt: Date.now(),
        });

        emit("run.statusChanged", {
          runId: run.id,
          status: "queued",
          jobId: run.jobId,
        });

        enqueued++;
      }

      if (deferredDue.length > 0) {
        console.error(`[scheduler] promoted ${deferredDue.length} deferred run(s) to queued`);
      }

      // ── 3. Safety net: re-enqueue orphaned "queued" runs ──
      const queuedRuns = listRuns({ status: "queued", limit: 100 });
      for (const run of queuedRuns) {
        if (!jobQueue.has(run.id)) {
          const priority = run.triggerSource === "manual" ? 0
            : run.triggerSource === "corrective" ? 2 : 1;
          jobQueue.enqueue({
            runId: run.id,
            jobId: run.jobId,
            priority,
            enqueuedAt: Date.now(),
          });
          enqueued++;
          console.error(`[scheduler] re-enqueued orphaned queued run ${run.id}`);
        }
      }

      if (enqueued > 0) {
        this.onWorkEnqueued?.();
      }

      // ── 4. Periodic usage tracking ──
      this.tickCount++;
      if (this.tickCount % USAGE_REFRESH_EVERY_N_TICKS === 0) {
        usageService.refresh().catch((err) =>
          console.error("[scheduler] usage refresh error:", err),
        );
      }
    } catch (err) {
      console.error("[scheduler] tick error:", err);
    }
  }
}

/** Singleton scheduler instance */
export const scheduler = new Scheduler();

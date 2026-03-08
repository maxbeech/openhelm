/**
 * Scheduler — ticks every 60 seconds, enqueues due jobs.
 *
 * The scheduler has one job: query the database for enabled jobs whose
 * nextFireAt is in the past, create run records, enqueue them, and update
 * nextFireAt. It does NOT execute jobs or manage processes.
 */

import { jobQueue } from "./queue.js";
import { computeNextFireAt } from "./schedule.js";
import { listDueJobs, updateJobNextFireAt } from "../db/queries/jobs.js";
import { createRun } from "../db/queries/runs.js";
import { emit } from "../ipc/emitter.js";

const TICK_INTERVAL_MS = 60_000; // 1 minute

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private _running = false;
  private onWorkEnqueued: (() => void) | null = null;

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
      const dueJobs = listDueJobs();
      if (dueJobs.length === 0) return;

      console.error(`[scheduler] found ${dueJobs.length} due job(s)`);
      let enqueued = 0;

      for (const job of dueJobs) {
        // Create a run record
        const run = createRun({
          jobId: job.id,
          triggerSource: "scheduled",
        });

        // Enqueue with scheduled priority
        jobQueue.enqueue({
          runId: run.id,
          jobId: job.id,
          priority: 1,
          enqueuedAt: Date.now(),
        });

        // Compute and update nextFireAt
        const nextFireAt = computeNextFireAt(
          job.scheduleType,
          job.scheduleConfig,
          new Date(),
        );
        updateJobNextFireAt(job.id, nextFireAt);

        emit("run.statusChanged", {
          runId: run.id,
          status: "queued",
          jobId: job.id,
        });

        enqueued++;
      }

      if (enqueued > 0) {
        console.error(`[scheduler] enqueued ${enqueued} run(s)`);
        this.onWorkEnqueued?.();
      }
    } catch (err) {
      console.error("[scheduler] tick error:", err);
    }
  }
}

/** Singleton scheduler instance */
export const scheduler = new Scheduler();

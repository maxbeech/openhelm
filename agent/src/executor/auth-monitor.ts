/**
 * Auth Monitor — reactive detection of Claude Code authentication failures
 * from run stderr, with auto-pause and auto-resume support.
 *
 * Detection is purely reactive: we inspect stderr after a run completes.
 * No polling, no LLM usage.
 */

import { eq, and } from "drizzle-orm";
import { getDb } from "../db/init.js";
import { dashboardItems } from "../db/schema.js";
import { createDashboardItem } from "../db/queries/dashboard-items.js";
import { createJob } from "../db/queries/jobs.js";
import { listJobs } from "../db/queries/jobs.js";
import { createRun } from "../db/queries/runs.js";
import { getSetting, setSetting, deleteSetting } from "../db/queries/settings.js";
import { checkClaudeCodeHealth } from "../claude-code/detector.js";
import { emit } from "../ipc/emitter.js";
import type { Job } from "@openhelm/shared";
import type { QueueItem } from "../scheduler/queue.js";

/**
 * Auth error patterns — matches common Claude Code authentication failures.
 * Aligned with the regex in detector.ts checkClaudeCodeHealth().
 */
const AUTH_ERROR_PATTERN =
  /not\s+logged\s+in|unauthenticated|unauthorized|session\s+expired|sign[\s-]?in\s+required|login\s+required|please\s+(log|sign)\s+in|authentication\s+failed|invalid.*api[\s_-]?key/i;

/** Test whether stderr output indicates an authentication failure. */
export function isAuthError(stderr: string): boolean {
  return AUTH_ERROR_PATTERN.test(stderr);
}

const SYSTEM_HEALTH_CATEGORY = "health_monitoring";

/**
 * Get or lazily create a sentinel "__system_health__" job for a project.
 * Used as the jobId for system-wide dashboard items (auth alerts).
 */
export function getOrCreateSystemHealthJob(projectId: string): Job {
  // Check for existing sentinel
  const existing = listJobs({ projectId }).find(
    (j) => j.source === "system" && j.systemCategory === SYSTEM_HEALTH_CATEGORY,
  );
  if (existing) return existing;

  // Create sentinel job — disabled, manual schedule, never fires
  return createJob({
    projectId,
    name: "System Health",
    description: "Internal sentinel for system-wide health alerts",
    prompt: "",
    scheduleType: "manual",
    scheduleConfig: {},
    isEnabled: false,
    source: "system",
    systemCategory: SYSTEM_HEALTH_CATEGORY,
  });
}

/**
 * Check if there is already an open auth_required dashboard item for a project.
 */
function hasOpenAuthAlert(projectId: string): boolean {
  const db = getDb();
  const row = db
    .select({ id: dashboardItems.id })
    .from(dashboardItems)
    .where(
      and(
        eq(dashboardItems.projectId, projectId),
        eq(dashboardItems.type, "auth_required"),
        eq(dashboardItems.status, "open"),
      ),
    )
    .get();
  return !!row;
}

/** Tracked interrupted runs for later resume. */
export interface InterruptedRun {
  runId: string;
  jobId: string;
}

/** Get interrupted runs from settings. */
export function getInterruptedRuns(): InterruptedRun[] {
  const setting = getSetting("auth_interrupted_runs");
  if (!setting?.value) return [];
  try {
    return JSON.parse(setting.value) as InterruptedRun[];
  } catch {
    return [];
  }
}

/** Clear the interrupted runs list. */
export function clearInterruptedRuns(): void {
  deleteSetting("auth_interrupted_runs");
}

/** Append a run to the interrupted runs list. */
function addInterruptedRun(runId: string, jobId: string): void {
  const current = getInterruptedRuns();
  // Avoid duplicates
  if (current.some((r) => r.runId === runId)) return;
  current.push({ runId, jobId });
  setSetting("auth_interrupted_runs", JSON.stringify(current));
}

/**
 * Handle an auth failure detected from a run's stderr.
 * Creates a dashboard alert, pauses the scheduler, and records the
 * interrupted run for later auto-resume.
 */
export function handleAuthFailure(
  runId: string,
  jobId: string,
  projectId: string,
): void {
  console.error(`[auth-monitor] auth failure detected for run ${runId}`);

  // Record this run for later resume
  addInterruptedRun(runId, jobId);

  // Create alert only if none open for this project
  if (!hasOpenAuthAlert(projectId)) {
    const sentinelJob = getOrCreateSystemHealthJob(projectId);
    const item = createDashboardItem({
      runId,
      jobId: sentinelJob.id,
      projectId,
      type: "auth_required",
      title: "Claude Code authentication required",
      message:
        'Claude Code has lost authentication. Run `claude` in your terminal to log in, then click "I\'ve Re-authenticated" to resume interrupted jobs.',
    });
    emit("dashboard.created", item);
  }

  // Pause scheduler to prevent cascading failures
  const alreadyPaused = getSetting("scheduler_paused")?.value === "true";
  if (!alreadyPaused) {
    setSetting("scheduler_paused", "true");
    emit("scheduler.statusChanged", { paused: true, reason: "auth_required" });
    console.error("[auth-monitor] scheduler paused due to auth failure");
  }
}

/**
 * Attempt to resume after re-authentication.
 * Runs a health check, and if healthy, re-enqueues interrupted jobs and
 * resumes the scheduler.
 */
export async function attemptAuthResume(
  enqueueFn: (item: QueueItem) => void,
): Promise<{ success: boolean; resumed: number; error?: string }> {
  const health = await checkClaudeCodeHealth();
  if (!health.healthy || !health.authenticated) {
    return {
      success: false,
      resumed: 0,
      error: health.error ?? "Claude Code is still not authenticated.",
    };
  }

  const interrupted = getInterruptedRuns();
  let resumed = 0;

  // Create new manual runs for each interrupted job
  for (const { jobId } of interrupted) {
    try {
      const run = createRun({ jobId, triggerSource: "manual" });
      enqueueFn({
        runId: run.id,
        jobId,
        priority: 0, // manual priority
        enqueuedAt: Date.now(),
      });
      emit("run.created", { runId: run.id, jobId });
      emit("run.statusChanged", {
        runId: run.id,
        status: "queued",
        previousStatus: "queued",
      });
      resumed++;
    } catch (err) {
      console.error(`[auth-monitor] failed to re-enqueue job ${jobId}:`, err);
    }
  }

  clearInterruptedRuns();

  // Resume scheduler
  deleteSetting("scheduler_paused");
  emit("scheduler.statusChanged", { paused: false });

  // Resolve all open auth_required dashboard items
  const db = getDb();
  const now = new Date().toISOString();
  db.update(dashboardItems)
    .set({ status: "resolved", resolvedAt: now })
    .where(
      and(
        eq(dashboardItems.type, "auth_required"),
        eq(dashboardItems.status, "open"),
      ),
    )
    .run();

  console.error(`[auth-monitor] auth resumed — ${resumed} jobs re-enqueued`);
  return { success: true, resumed };
}

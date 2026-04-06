/**
 * CLI Error Monitor — detects transient Claude Code CLI / API errors
 * that should NOT trigger self-correction (which would just waste tokens
 * and rate limit on the same transient issue).
 *
 * Examples of transient errors:
 * - "error: An unknown error occurred (Unexpected)"
 * - "error: Overloaded"
 * - "error: API Error"
 * - Rate limit / capacity errors
 *
 * When detected, the run is kept as "failed" (not permanent_failure),
 * self-correction is skipped, and the scheduler is paused if consecutive
 * transient failures exceed a threshold.
 */

import { getSetting, setSetting, deleteSetting } from "../db/queries/settings.js";
import { createDashboardItem } from "../db/queries/dashboard-items.js";
import { getOrCreateSystemHealthJob } from "./auth-monitor.js";
import { emit } from "../ipc/emitter.js";
import { scheduler } from "../scheduler/index.js";

/**
 * Patterns matching transient CLI / API errors in stderr.
 * These are errors from the Claude Code CLI itself (not from the task),
 * indicating the API is unavailable or rate-limited.
 */
const TRANSIENT_CLI_ERROR_PATTERN =
  /error:\s*(An unknown error occurred|Overloaded|API Error|Internal server error|Service unavailable|Too many requests|Rate limit|Gateway timeout|Bad gateway)/i;

/** Track consecutive transient failures for circuit-breaker logic. */
const CONSECUTIVE_FAIL_THRESHOLD = 5;
const CONSECUTIVE_FAIL_SETTING = "cli_error_consecutive_count";
const CONSECUTIVE_FAIL_FIRST_AT = "cli_error_first_at";

/**
 * Test whether stderr output indicates a transient CLI/API error.
 * Only matches when the stderr is short (under 500 chars) — longer output
 * likely contains real task context, not a bare CLI error.
 */
export function isTransientCliError(stderr: string): boolean {
  if (stderr.length > 500) return false;
  return TRANSIENT_CLI_ERROR_PATTERN.test(stderr);
}

/**
 * Record a transient CLI error occurrence and return whether the
 * circuit breaker should trip (pause scheduler).
 */
export function recordTransientError(): { shouldPause: boolean; count: number } {
  const currentStr = getSetting(CONSECUTIVE_FAIL_SETTING)?.value;
  const current = currentStr ? parseInt(currentStr, 10) : 0;
  const next = current + 1;

  if (next === 1) {
    setSetting(CONSECUTIVE_FAIL_FIRST_AT, new Date().toISOString());
  }

  setSetting(CONSECUTIVE_FAIL_SETTING, String(next));
  return { shouldPause: next >= CONSECUTIVE_FAIL_THRESHOLD, count: next };
}

/** Reset the consecutive transient error counter (called on successful run). */
export function resetTransientErrorCount(): void {
  deleteSetting(CONSECUTIVE_FAIL_SETTING);
  deleteSetting(CONSECUTIVE_FAIL_FIRST_AT);
}

/**
 * Handle a transient CLI error: log it, record the occurrence,
 * and pause the scheduler if consecutive failures exceed the threshold.
 */
export function handleTransientCliError(
  runId: string,
  jobId: string,
  projectId: string,
  errorText: string,
): void {
  console.error(`[cli-error-monitor] transient CLI error for run ${runId}: ${errorText.trim()}`);

  const { shouldPause, count } = recordTransientError();

  if (shouldPause) {
    // Pause the scheduler to stop cascading failures
    const alreadyPaused = getSetting("scheduler_paused")?.value === "true";
    if (!alreadyPaused) {
      scheduler.stop();
      setSetting("scheduler_paused", "true");
      emit("scheduler.statusChanged", { paused: true, reason: "cli_error" });
      console.error(`[cli-error-monitor] scheduler paused after ${count} consecutive transient errors`);
    }

    // Create dashboard alert
    const sentinelJob = getOrCreateSystemHealthJob(projectId);
    const item = createDashboardItem({
      runId,
      jobId: sentinelJob.id,
      projectId,
      type: "human_in_loop",
      title: "Claude Code API errors — scheduler paused",
      message:
        `${count} consecutive runs failed with a transient Claude Code CLI error: "${errorText.trim()}". ` +
        "This usually means the API is temporarily unavailable or rate-limited. " +
        "The scheduler has been paused to prevent further wasted runs. " +
        "Resume the scheduler once the issue resolves.",
    });
    emit("dashboard.created", item);
  }
}

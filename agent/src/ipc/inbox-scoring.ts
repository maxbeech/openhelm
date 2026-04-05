/**
 * Pure-function module for computing inbox event importance scores.
 * No side effects — deterministic and easily unit-testable.
 */

export interface EventContext {
  triggerSource?: string;
  consecutiveFailures?: number;
  memoryImportance?: number;
  rowCount?: number;
  hasToolCalls?: boolean;
  hasPendingActions?: boolean;
  jobSource?: string;
  runStatus?: string;
}

// ─── Base Scores ───

const BASE_SCORES: Record<string, number> = {
  // Alerts
  "alert.permanent_failure": 90,
  "alert.auth_required": 85,
  "alert.captcha_intervention": 80,
  "alert.human_in_loop": 75,
  "alert.mcp_unavailable": 70,
  "alert.autopilot_limit": 65,
  "alert.captain_insight": 60,

  // Actions
  "action.proposal_created": 70,
  "action.action_pending": 65,

  // Runs
  "run.started": 25,
  "run.completed.permanent_failure": 85,
  "run.completed.failed": 60,
  "run.completed.succeeded": 35,
  "run.completed.cancelled": 20,

  // Chat
  "chat.assistant_message_with_actions": 65,
  "chat.assistant_message": 50,

  // Insights
  "insight.captain_insight": 60,

  // Credentials
  "credential.deleted": 45,
  "credential.created": 40,
  "credential.updated": 30,

  // Data
  "data.dataTable.deleted": 35,
  "data.dataTable.created": 25,
  "data.dataTable.rows_bulk": 15,
  "data.dataTable.row_edit": 10,

  // Memory
  "memory.deleted": 25,
  "memory.created": 20,
  "memory.updated": 15,

  // System
  "system.scheduled_run": 15,
};

/**
 * Look up the base importance for a given scoring key.
 * Falls back to 50 if unrecognized.
 */
export function getBaseImportance(scoringKey: string): number {
  return BASE_SCORES[scoringKey] ?? 50;
}

/**
 * Compute the final importance score from a base score and contextual modifiers.
 * Always returns an integer clamped to [0, 100].
 */
export function computeImportance(
  base: number,
  ctx: EventContext = {},
): number {
  let score = base;

  if (ctx.triggerSource === "corrective") score += 10;
  if (ctx.triggerSource === "manual") score += 5;

  if (ctx.consecutiveFailures != null && ctx.consecutiveFailures >= 3) {
    score += 10;
  }

  if (ctx.memoryImportance != null) {
    score += (ctx.memoryImportance - 5) * 2;
  }

  if (ctx.rowCount != null) {
    if (ctx.rowCount > 100) score += 10;
    else if (ctx.rowCount > 10) score += 5;
  }

  if (ctx.hasToolCalls) score += 5;
  if (ctx.hasPendingActions) score += 10;
  if (ctx.jobSource === "system") score -= 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

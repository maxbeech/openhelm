/**
 * Autopilot Metrics — collects system health metrics and writes to data tables.
 *
 * Pure DB queries for metric collection (no LLM calls).
 * Reads rules from the Autopilot Rules table, computes each metric,
 * and writes a row to the Autopilot Metrics table.
 */

import {
  getDataTableRows,
  insertDataTableRows,
  deleteDataTableRows,
} from "../db/queries/data-tables.js";
import { listGoals } from "../db/queries/goals.js";
import { listJobs } from "../db/queries/jobs.js";
import { listRuns } from "../db/queries/runs.js";
import { listTargets } from "../db/queries/targets.js";
import { evaluateTargets } from "../data-tables/target-evaluator.js";
import { getSystemTokenUsageForGoal, getUserTokenUsageForGoal } from "../db/queries/runs.js";
import type { DataTable, DataTableRow, TargetDirection } from "@openhelm/shared";

// ─── Rule reading ───

export interface AutopilotRule {
  rowId: string;
  ruleName: string;
  description: string;
  metricColumn: string;
  threshold: number;
  direction: TargetDirection;
  cooldownHours: number;
  enabled: boolean;
}

/** Read all enabled rules from the Autopilot Rules data table. */
export function getEnabledRules(rulesTable: DataTable): AutopilotRule[] {
  const rows = getDataTableRows({ tableId: rulesTable.id, limit: 100 });
  const rules: AutopilotRule[] = [];

  for (const row of rows) {
    const d = row.data;
    const enabled = Number(d.col_enabled) === 1;
    if (!enabled) continue;

    rules.push({
      rowId: row.id,
      ruleName: String(d.col_rule_name ?? ""),
      description: String(d.col_description ?? ""),
      metricColumn: String(d.col_metric_column ?? ""),
      threshold: Number(d.col_threshold ?? 0),
      direction: (d.col_direction as TargetDirection) ?? "lte",
      cooldownHours: Number(d.col_cooldown_hours ?? 4),
      enabled: true,
    });
  }

  return rules;
}

// ─── Metric collection ───

export interface MetricValues {
  [metricColumn: string]: number;
}

/**
 * Collect current metric values for a project based on active rules.
 * Each rule's metricColumn maps to a collector function.
 */
export function collectMetrics(
  projectId: string,
  rules: AutopilotRule[],
): MetricValues {
  const values: MetricValues = {};

  for (const rule of rules) {
    const collector = METRIC_COLLECTORS[rule.metricColumn];
    if (collector) {
      try {
        values[rule.metricColumn] = collector(projectId);
      } catch (err) {
        console.error(`[autopilot] failed to collect ${rule.metricColumn}:`, err);
        values[rule.metricColumn] = 0;
      }
    }
  }

  return values;
}

// ─── Metric collector functions ───

type MetricCollector = (projectId: string) => number;

const METRIC_COLLECTORS: Record<string, MetricCollector> = {
  goal_success_rate: collectGoalSuccessRate,
  perm_failure_count: collectPermanentFailureCount,
  stale_job_count: collectStaleJobCount,
  off_track_target_count: collectOffTrackTargetCount,
  token_usage_pct: collectTokenUsagePct,
};

function collectGoalSuccessRate(projectId: string): number {
  const runs = listRuns({ projectId, limit: 200 });
  // Filter to last 14 days
  const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const recent = runs.filter(
    (r) => r.createdAt >= cutoff && (r.status === "succeeded" || r.status === "failed" || r.status === "permanent_failure"),
  );
  if (recent.length === 0) return 1; // No data = assume healthy
  const succeeded = recent.filter((r) => r.status === "succeeded").length;
  return Math.round((succeeded / recent.length) * 100) / 100;
}

function collectPermanentFailureCount(projectId: string): number {
  const runs = listRuns({ projectId, status: "permanent_failure", limit: 100 });
  // Count only those from the last scan interval (approx 30min)
  const cutoff = new Date(Date.now() - 35 * 60_000).toISOString();
  return runs.filter((r) => r.createdAt >= cutoff).length;
}

function collectStaleJobCount(projectId: string): number {
  const allJobs = listJobs({ projectId, isEnabled: true });
  const staleDays = 7;
  const cutoff = new Date(Date.now() - staleDays * 86_400_000).toISOString();
  const now = new Date().toISOString();
  let staleCount = 0;

  for (const job of allJobs) {
    // Skip system jobs from counting as stale
    if (job.source === "system") continue;
    // Skip jobs scheduled for the future (not yet due)
    if (job.nextFireAt && job.nextFireAt > now) continue;
    const jobRuns = listRuns({ jobId: job.id, limit: 1 });
    if (jobRuns.length === 0) {
      staleCount++; // Never run and not scheduled for future
    } else if (jobRuns[0].createdAt < cutoff) {
      staleCount++; // Last run is old
    }
  }

  return staleCount;
}

function collectOffTrackTargetCount(projectId: string): number {
  const goals = listGoals({ projectId, status: "active" });
  let offTrack = 0;

  for (const goal of goals) {
    if (goal.isSystem) continue; // Skip system goal's own targets
    const targets = listTargets({ goalId: goal.id });
    if (targets.length === 0) continue;
    const evals = evaluateTargets(targets);
    offTrack += evals.filter((e) => !e.met).length;
  }

  return offTrack;
}

function collectTokenUsagePct(projectId: string): number {
  const goals = listGoals({ projectId, status: "active" });
  let totalSystemTokens = 0;
  let totalUserTokens = 0;

  for (const goal of goals) {
    if (goal.isSystem) continue;
    totalSystemTokens += getSystemTokenUsageForGoal(goal.id);
    totalUserTokens += getUserTokenUsageForGoal(goal.id);
  }

  if (totalUserTokens < 1000) return 0; // Not enough data
  const budgetCeiling = totalUserTokens * 0.2;
  return Math.round((totalSystemTokens / budgetCeiling) * 100);
}

// ─── Row writing ───

/**
 * Write a metrics row to the Autopilot Metrics data table.
 * Each metric column gets its current value.
 */
export function writeMetricsRow(
  metricsTable: DataTable,
  values: MetricValues,
): DataTableRow {
  const rowData: Record<string, unknown> = {
    col_collected_at: new Date().toISOString(),
  };

  for (const [metricColumn, value] of Object.entries(values)) {
    rowData[`col_${metricColumn}`] = value;
  }

  const inserted = insertDataTableRows({
    tableId: metricsTable.id,
    rows: [rowData],
    actor: "system",
  });

  return inserted[0];
}

// ─── Pruning ───

/** Remove metrics rows older than retentionDays. */
export function pruneOldMetricsRows(
  metricsTable: DataTable,
  retentionDays: number,
): number {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const rows = getDataTableRows({ tableId: metricsTable.id, limit: 10000 });
  const toDelete = rows
    .filter((r) => {
      const collectedAt = r.data.col_collected_at;
      return typeof collectedAt === "string" && collectedAt < cutoff;
    })
    .map((r) => r.id);

  if (toDelete.length === 0) return 0;

  return deleteDataTableRows({
    rowIds: toDelete,
    actor: "system",
  });
}

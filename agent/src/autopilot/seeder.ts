/**
 * Autopilot Seeder — creates system-level entities per project.
 *
 * Idempotent: safe to call on every scan tick.
 * Creates: Autopilot Maintenance goal, Autopilot Rules table,
 * Autopilot Metrics table, initial targets, meta-analysis job,
 * and system visualizations.
 */

import { createGoal, listGoals, updateGoal } from "../db/queries/goals.js";
import {
  createDataTable,
  listDataTables,
  updateDataTable,
  insertDataTableRows,
} from "../db/queries/data-tables.js";
import { createTarget, listTargets } from "../db/queries/targets.js";
import { createJob, listJobs } from "../db/queries/jobs.js";
import {
  createVisualization,
  listVisualizations,
  deleteVisualization,
} from "../db/queries/visualizations.js";
import type {
  Goal,
  DataTable,
  DataTableColumn,
  TargetDirection,
} from "@openhelm/shared";

// ─── Constants ───

const SYSTEM_GOAL_NAME = "Autopilot Maintenance";
const SYSTEM_GOAL_NAME_LEGACY = "System Maintenance"; // renamed — migrate on next scan
const RULES_TABLE_NAME = "Autopilot Rules";
const METRICS_TABLE_NAME = "Autopilot Metrics";
// Legacy names (renamed by migration 0037, kept here as fallback guard)
const RULES_TABLE_NAME_LEGACY = "Captain Rules";
const METRICS_TABLE_NAME_LEGACY = "Captain Metrics";
const META_JOB_NAME = "Health Rules Review";
const META_JOB_CATEGORY = "captain_meta"; // stored in DB — not renamed

// ─── Initial rule definitions ───

export interface AutopilotRuleSeed {
  ruleName: string;
  description: string;
  metricColumn: string;
  columnLabel: string; // pretty display name for the metric column
  threshold: number;
  direction: TargetDirection;
  cooldownHours: number;
}

export const INITIAL_RULES: AutopilotRuleSeed[] = [
  {
    ruleName: "Goal Success Rate",
    description: "Overall run success rate across all goals",
    metricColumn: "goal_success_rate",
    columnLabel: "Goal Success Rate",
    threshold: 0.7,
    direction: "gte",
    cooldownHours: 4,
  },
  {
    ruleName: "Permanent Failures",
    description: "Count of new permanent failures since last scan",
    metricColumn: "perm_failure_count",
    columnLabel: "Permanent Failures",
    threshold: 0,
    direction: "lte",
    cooldownHours: 4,
  },
  {
    ruleName: "Stale Jobs",
    description: "Enabled jobs not run in more than 7 days",
    metricColumn: "stale_job_count",
    columnLabel: "Stale Jobs",
    threshold: 0,
    direction: "lte",
    cooldownHours: 24,
  },
  {
    ruleName: "Off-Track Targets",
    description: "User targets that are not being met",
    metricColumn: "off_track_target_count",
    columnLabel: "Off-Track Targets",
    threshold: 0,
    direction: "lte",
    cooldownHours: 4,
  },
  {
    ruleName: "Token Budget Usage",
    description: "System job tokens as percentage of budget ceiling",
    metricColumn: "token_usage_pct",
    columnLabel: "Token Usage %",
    threshold: 80,
    direction: "lte",
    cooldownHours: 24,
  },
];

// ─── Column builders ───

function buildRulesColumns(): DataTableColumn[] {
  return [
    { id: "col_rule_name", name: "Rule Name", type: "text", config: {} },
    { id: "col_description", name: "Description", type: "text", config: {} },
    { id: "col_metric_column", name: "Metric Column", type: "text", config: {} },
    { id: "col_threshold", name: "Threshold", type: "number", config: {} },
    { id: "col_direction", name: "Direction", type: "text", config: {} },
    { id: "col_cooldown_hours", name: "Cooldown (Hours)", type: "number", config: {} },
    { id: "col_enabled", name: "Enabled", type: "number", config: {} },
  ];
}

function buildMetricsColumns(): DataTableColumn[] {
  return [
    { id: "col_collected_at", name: "Collected At", type: "date", config: {} },
    ...INITIAL_RULES.map((r) => ({
      id: `col_${r.metricColumn}`,
      name: r.columnLabel,
      type: "number" as const,
      config: {},
    })),
  ];
}

// ─── Public API ───

export interface SystemEntities {
  systemGoal: Goal;
  rulesTable: DataTable;
  metricsTable: DataTable;
}

/**
 * Ensure all autopilot system entities exist for a project.
 * Returns references to them. Idempotent.
 */
export function ensureSystemEntities(projectId: string): SystemEntities {
  const goal = ensureSystemGoal(projectId);
  const rulesTable = ensureRulesTable(projectId);
  const metricsTable = ensureMetricsTable(projectId);
  ensureInitialRuleRows(rulesTable);
  ensureInitialTargets(projectId, goal.id, metricsTable);
  ensureMetaJob(projectId, goal.id);
  ensureSystemVisualizations(projectId, goal.id, rulesTable, metricsTable);
  return { systemGoal: goal, rulesTable, metricsTable };
}

// ─── Internal helpers ───

function ensureSystemGoal(projectId: string): Goal {
  const allSystemGoals = listGoals({ projectId }).filter((g) => g.isSystem);

  // Migrate legacy "System Maintenance" name to new "Autopilot Maintenance"
  const legacy = allSystemGoals.find((g) => g.name === SYSTEM_GOAL_NAME_LEGACY);
  if (legacy) {
    return updateGoal({
      id: legacy.id,
      name: SYSTEM_GOAL_NAME,
      description: "Autopilot system health monitoring and maintenance",
      icon: "shield",
    });
  }

  const existing = allSystemGoals.find((g) => g.name === SYSTEM_GOAL_NAME);
  if (existing) {
    // Ensure icon is set even if goal was created before icon was added
    if (!existing.icon) {
      return updateGoal({ id: existing.id, icon: "shield" });
    }
    return existing;
  }

  // The unique partial index on goals(project_id, name) WHERE is_system = 1
  // prevents duplicates at the DB level. If a race condition causes a conflict,
  // catch and re-fetch the winner.
  try {
    return createGoal({
      projectId,
      name: SYSTEM_GOAL_NAME,
      description: "Autopilot system health monitoring and maintenance",
      isSystem: true,
      icon: "shield",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE constraint failed") || msg.includes("SQLITE_CONSTRAINT")) {
      const fallback = listGoals({ projectId })
        .find((g) => g.isSystem && g.name === SYSTEM_GOAL_NAME);
      if (fallback) return fallback;
    }
    throw err;
  }
}

const RULES_DESCRIPTION =
  "Autopilot monitoring rules. Each row defines a metric threshold that triggers an investigation when breached.";

const METRICS_DESCRIPTION =
  "Time-series health metrics collected by Autopilot on each scan. Each row is a snapshot of all monitored metric values at a point in time.";

function ensureRulesTable(projectId: string): DataTable {
  const allTables = listDataTables({ projectId });

  // Migrate legacy "Captain Rules" name
  const legacy = allTables.find(
    (t) => t.isSystem && t.name === RULES_TABLE_NAME_LEGACY,
  );
  if (legacy) {
    return updateDataTable({
      id: legacy.id,
      name: RULES_TABLE_NAME,
      description: RULES_DESCRIPTION,
    });
  }

  const existing = allTables.find((t) => t.isSystem && t.name === RULES_TABLE_NAME);
  if (existing) {
    // Update description if stale (e.g., stored old "AutoCaptain" wording)
    if (existing.description !== RULES_DESCRIPTION) {
      return updateDataTable({ id: existing.id, description: RULES_DESCRIPTION });
    }
    return existing;
  }

  return createDataTable({
    projectId,
    name: RULES_TABLE_NAME,
    description: RULES_DESCRIPTION,
    columns: buildRulesColumns(),
    isSystem: true,
    createdBy: "ai",
  });
}

function ensureMetricsTable(projectId: string): DataTable {
  const allTables = listDataTables({ projectId });

  // Migrate legacy "Captain Metrics" name
  const legacy = allTables.find(
    (t) => t.isSystem && t.name === METRICS_TABLE_NAME_LEGACY,
  );
  if (legacy) {
    return updateDataTable({
      id: legacy.id,
      name: METRICS_TABLE_NAME,
      description: METRICS_DESCRIPTION,
    });
  }

  const existing = allTables.find((t) => t.isSystem && t.name === METRICS_TABLE_NAME);
  if (existing) {
    // Update description if stale
    if (existing.description !== METRICS_DESCRIPTION) {
      return updateDataTable({ id: existing.id, description: METRICS_DESCRIPTION });
    }
    return existing;
  }

  return createDataTable({
    projectId,
    name: METRICS_TABLE_NAME,
    description: METRICS_DESCRIPTION,
    columns: buildMetricsColumns(),
    isSystem: true,
    createdBy: "ai",
  });
}

function ensureInitialRuleRows(rulesTable: DataTable): void {
  // Use the denormalized rowCount from the DataTable record as a fast guard.
  // This is safe because ensureSystemEntities is always called single-threaded
  // (one project at a time from the scanner). If rowCount were ever stale,
  // the duplicate inserts would be benign duplicates — there is no unique
  // constraint on row content in dataTableRows.
  if (rulesTable.rowCount > 0) return;

  const rows = INITIAL_RULES.map((r) => ({
    col_rule_name: r.ruleName,
    col_description: r.description,
    col_metric_column: r.metricColumn,
    col_threshold: r.threshold,
    col_direction: r.direction,
    col_cooldown_hours: r.cooldownHours,
    col_enabled: 1,
  }));

  insertDataTableRows({
    tableId: rulesTable.id,
    rows,
    actor: "system" as const,
  });
}

function ensureInitialTargets(
  projectId: string,
  goalId: string,
  metricsTable: DataTable,
): void {
  const existing = listTargets({ goalId });
  if (existing.length > 0) return;

  for (const rule of INITIAL_RULES) {
    const columnId = `col_${rule.metricColumn}`;
    createTarget({
      goalId,
      projectId,
      dataTableId: metricsTable.id,
      columnId,
      targetValue: rule.threshold,
      direction: rule.direction,
      aggregation: "latest",
      label: rule.ruleName,
      createdBy: "ai",
    });
  }
}

function ensureMetaJob(projectId: string, goalId: string): void {
  const existing = listJobs({ goalId })
    .find((j) => j.systemCategory === META_JOB_CATEGORY);
  if (existing) return;

  createJob({
    projectId,
    goalId,
    name: META_JOB_NAME,
    description: "Weekly review of Autopilot monitoring rules and targets",
    prompt: buildMetaJobPrompt(),
    scheduleType: "cron",
    scheduleConfig: { expression: "0 2 * * 0" }, // Sundays at 2am
    source: "system",
    systemCategory: META_JOB_CATEGORY,
    model: "haiku",
    modelEffort: "low",
  });
}

/**
 * Ensure system visualizations for the Autopilot tables are correct.
 * This is authoritative: any existing system viz that doesn't match the
 * expected config (wrong chart type, wrong xColumnId, wrong name) is deleted
 * and recreated. This handles cases where the suggester auto-created a bad
 * chart before the seeder got a chance to run.
 *
 * - Autopilot Metrics: line chart over time with pretty metric labels
 * - Autopilot Rules: stat showing count of enabled rules
 */
function ensureSystemVisualizations(
  projectId: string,
  goalId: string,
  rulesTable: DataTable,
  metricsTable: DataTable,
): void {
  // ── Autopilot Metrics: must be a line chart with xColumnId set ──
  if (metricsTable.rowCount >= 1) {
    const existingVizs = listVisualizations({ dataTableId: metricsTable.id });
    const correctViz = existingVizs.find(
      (v) => v.chartType === "line" && v.config.xColumnId === "col_collected_at",
    );

    if (!correctViz) {
      // Delete any wrong vizs (bad chart type / bad x-axis / suggested from backfill)
      for (const v of existingVizs) deleteVisualization(v.id);

      createVisualization({
        projectId,
        goalId,
        dataTableId: metricsTable.id,
        name: "Autopilot Metrics",
        description:
          "Time-series view of system health metrics collected on each Autopilot scan. Each line tracks a monitoring metric over time — breach of a rule's threshold triggers an investigation.",
        chartType: "line",
        config: {
          xColumnId: "col_collected_at",
          series: INITIAL_RULES.map((r) => ({
            columnId: `col_${r.metricColumn}`,
            label: r.columnLabel,
          })),
          showLegend: true,
          showGrid: true,
        },
        status: "active",
        source: "system",
      });
    }
  }

  // ── Autopilot Rules: must be a stat card for enabled count ──
  if (rulesTable.rowCount >= 1) {
    const existingVizs = listVisualizations({ dataTableId: rulesTable.id });
    const correctViz = existingVizs.find(
      (v) => v.chartType === "stat" && v.config.statColumnId === "col_enabled",
    );

    if (!correctViz) {
      for (const v of existingVizs) deleteVisualization(v.id);

      createVisualization({
        projectId,
        goalId,
        dataTableId: rulesTable.id,
        name: "Autopilot Rules",
        description:
          "Number of monitoring rules currently active. Each rule defines a metric, a threshold, and a cooldown — Autopilot checks these on every scan and triggers investigations when a threshold is breached.",
        chartType: "stat",
        config: {
          series: [],
          statColumnId: "col_enabled",
          statAggregation: "sum",
          statLabel: "Active Rules",
          showLegend: false,
          showGrid: false,
        },
        status: "active",
        source: "system",
      });
    }
  }
}

function buildMetaJobPrompt(): string {
  return `You are the OpenHelm Autopilot Health Rules Reviewer for this project.

Your job is to review the monitoring rules in the "Autopilot Rules" data table and ensure they are accurate, relevant, and effective for the current state of this project.

## What to do

1. List all current rules by reading the "Autopilot Rules" data table
2. Review each rule's threshold and direction against recent project activity
3. Check if any new monitoring rules should be added (e.g., for new goals or jobs)
4. Check if any existing rules are no longer relevant and should be disabled
5. Update thresholds if they are too sensitive (causing false alarms) or too lenient (missing issues)

## Available actions

- Use the data table MCP tools to read/update the Autopilot Rules table
- Use the target MCP tools to update corresponding targets on the Autopilot Metrics table
- When adding a new rule: add a row to Autopilot Rules, add a column to Autopilot Metrics, and create a target

## Guidelines

- Be conservative — only change rules that clearly need updating
- Prefer adjusting thresholds over adding new rules
- Output a brief summary of changes made (1-3 paragraphs)`;
}

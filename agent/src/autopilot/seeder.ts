/**
 * Autopilot Seeder — creates system-level entities per project.
 *
 * Idempotent: safe to call on every scan tick.
 * Creates: Autopilot Maintenance goal, Autopilot Rules table,
 * Autopilot Metrics table, initial targets, and meta-analysis job.
 */

import { createGoal, listGoals, updateGoal } from "../db/queries/goals.js";
import {
  createDataTable,
  listDataTables,
  insertDataTableRows,
} from "../db/queries/data-tables.js";
import { createTarget, listTargets } from "../db/queries/targets.js";
import { createJob, listJobs } from "../db/queries/jobs.js";
import type {
  Goal,
  DataTable,
  DataTableColumn,
  TargetDirection,
} from "@openhelm/shared";

// ─── Constants ───

const SYSTEM_GOAL_NAME = "Autopilot Maintenance";
const SYSTEM_GOAL_NAME_LEGACY = "System Maintenance"; // renamed — migrate on next scan
const RULES_TABLE_NAME = "Captain Rules";
const METRICS_TABLE_NAME = "Captain Metrics";
const META_JOB_NAME = "Health Rules Review";
const META_JOB_CATEGORY = "captain_meta"; // stored in DB — not renamed

// ─── Initial rule definitions ───

export interface AutopilotRuleSeed {
  ruleName: string;
  description: string;
  metricColumn: string;
  threshold: number;
  direction: TargetDirection;
  cooldownHours: number;
}

export const INITIAL_RULES: AutopilotRuleSeed[] = [
  {
    ruleName: "Goal Success Rate",
    description: "Overall run success rate across all goals",
    metricColumn: "goal_success_rate",
    threshold: 0.7,
    direction: "gte",
    cooldownHours: 4,
  },
  {
    ruleName: "Permanent Failures",
    description: "Count of new permanent failures since last scan",
    metricColumn: "perm_failure_count",
    threshold: 0,
    direction: "lte",
    cooldownHours: 4,
  },
  {
    ruleName: "Stale Jobs",
    description: "Enabled jobs not run in more than 7 days",
    metricColumn: "stale_job_count",
    threshold: 0,
    direction: "lte",
    cooldownHours: 24,
  },
  {
    ruleName: "Off-Track Targets",
    description: "User targets that are not being met",
    metricColumn: "off_track_target_count",
    threshold: 0,
    direction: "lte",
    cooldownHours: 4,
  },
  {
    ruleName: "Token Budget Usage",
    description: "System job tokens as percentage of budget ceiling",
    metricColumn: "token_usage_pct",
    threshold: 80,
    direction: "lte",
    cooldownHours: 24,
  },
];

// ─── Column builders ───

function buildRulesColumns(): DataTableColumn[] {
  return [
    { id: "col_rule_name", name: "rule_name", type: "text", config: {} },
    { id: "col_description", name: "description", type: "text", config: {} },
    { id: "col_metric_column", name: "metric_column", type: "text", config: {} },
    { id: "col_threshold", name: "threshold", type: "number", config: {} },
    { id: "col_direction", name: "direction", type: "text", config: {} },
    { id: "col_cooldown_hours", name: "cooldown_hours", type: "number", config: {} },
    { id: "col_enabled", name: "enabled", type: "number", config: {} },
  ];
}

function buildMetricsColumns(): DataTableColumn[] {
  return [
    { id: "col_collected_at", name: "collected_at", type: "text", config: {} },
    ...INITIAL_RULES.map((r) => ({
      id: `col_${r.metricColumn}`,
      name: r.metricColumn,
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

function ensureRulesTable(projectId: string): DataTable {
  const existing = listDataTables({ projectId })
    .find((t) => t.isSystem && t.name === RULES_TABLE_NAME);
  if (existing) return existing;

  return createDataTable({
    projectId,
    name: RULES_TABLE_NAME,
    description: "Monitoring rules for Autopilot health checks",
    columns: buildRulesColumns(),
    isSystem: true,
    createdBy: "ai",
  });
}

function ensureMetricsTable(projectId: string): DataTable {
  const existing = listDataTables({ projectId })
    .find((t) => t.isSystem && t.name === METRICS_TABLE_NAME);
  if (existing) return existing;

  return createDataTable({
    projectId,
    name: METRICS_TABLE_NAME,
    description: "Time-series health metrics collected by Autopilot",
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

function buildMetaJobPrompt(): string {
  return `You are the OpenHelm Autopilot Health Rules Reviewer for this project.

Your job is to review the monitoring rules in the "Captain Rules" data table and ensure they are accurate, relevant, and effective for the current state of this project.

## What to do

1. List all current rules by reading the "Captain Rules" data table
2. Review each rule's threshold and direction against recent project activity
3. Check if any new monitoring rules should be added (e.g., for new goals or jobs)
4. Check if any existing rules are no longer relevant and should be disabled
5. Update thresholds if they are too sensitive (causing false alarms) or too lenient (missing issues)

## Available actions

- Use the data table MCP tools to read/update the Captain Rules table
- Use the target MCP tools to update corresponding targets on the Captain Metrics table
- When adding a new rule: add a row to Captain Rules, add a column to Captain Metrics, and create a target

## Guidelines

- Be conservative — only change rules that clearly need updating
- Prefer adjusting thresholds over adding new rules
- Output a brief summary of changes made (1-3 paragraphs)`;
}

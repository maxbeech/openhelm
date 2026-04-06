/**
 * Autopilot Investigation — spawns Tier 2 investigation jobs.
 *
 * When the scanner detects a target breach, it spawns a focused
 * investigation job under the Autopilot Maintenance goal. The job
 * runs through the normal executor with full Claude Code access.
 */

import { createJob, listJobs } from "../db/queries/jobs.js";
import { listRuns } from "../db/queries/runs.js";
import { getSetting, setSetting } from "../db/queries/settings.js";
import type { TargetEvaluation } from "@openhelm/shared";
import type { AutopilotRule, MetricValues } from "./metrics.js";

const INVESTIGATION_CATEGORY = "captain_investigation"; // stored in DB — not renamed
const DEFAULT_COOLDOWN_HOURS = 4;

// ─── Cooldown management ───

interface CooldownMap {
  [key: string]: number; // "metricColumn:projectId" → timestamp
}

function getCooldownMap(): CooldownMap {
  const setting = getSetting("autopilot_investigation_cooldowns");
  if (!setting?.value) return {};
  try {
    return JSON.parse(setting.value) as CooldownMap;
  } catch {
    return {};
  }
}

function setCooldown(metricColumn: string, projectId: string): void {
  const map = getCooldownMap();
  map[`${metricColumn}:${projectId}`] = Date.now();
  setSetting("autopilot_investigation_cooldowns", JSON.stringify(map));
}

/** Check if an investigation was recently spawned for this metric. */
export function isOnCooldown(
  metricColumn: string,
  projectId: string,
  cooldownHours = DEFAULT_COOLDOWN_HOURS,
): boolean {
  // Also check if there's an active (queued/running) investigation
  const activeJobs = listJobs({ projectId }).filter(
    (j) =>
      j.systemCategory === INVESTIGATION_CATEGORY &&
      j.name.includes(metricColumn),
  );
  for (const job of activeJobs) {
    const runs = listRuns({ jobId: job.id, limit: 1 });
    if (runs.length > 0 && (runs[0].status === "queued" || runs[0].status === "running")) {
      return true; // Active investigation already running
    }
  }

  const map = getCooldownMap();
  const lastSpawned = map[`${metricColumn}:${projectId}`];
  if (!lastSpawned) return false;
  return Date.now() - lastSpawned < cooldownHours * 3_600_000;
}

// ─── Job spawning ───

/** Spawn a focused investigation job for a specific target breach. */
export async function spawnInvestigation(
  projectId: string,
  systemGoalId: string,
  rule: AutopilotRule,
  breach: TargetEvaluation,
  recentValues: MetricValues,
): Promise<void> {
  const prompt = buildInvestigationPrompt(rule, breach, recentValues);

  createJob({
    projectId,
    goalId: systemGoalId,
    name: `Investigate: ${rule.ruleName}`,
    description: `Autopilot detected ${rule.ruleName} breached threshold (current: ${breach.currentValue}, threshold: ${rule.threshold})`,
    prompt,
    scheduleType: "once",
    scheduleConfig: { fireAt: new Date(Date.now() + 30_000).toISOString() },
    source: "system",
    systemCategory: INVESTIGATION_CATEGORY,
    model: "haiku",
    modelEffort: "low",
  });

  setCooldown(rule.metricColumn, projectId);

  console.error(
    `[autopilot] spawned investigation for ${rule.ruleName} in project ${projectId}`,
  );
}

// ─── Prompt building ───

function buildInvestigationPrompt(
  rule: AutopilotRule,
  breach: TargetEvaluation,
  recentValues: MetricValues,
): string {
  const valuesStr = Object.entries(recentValues)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");

  return `You are the OpenHelm Autopilot, investigating a health metric breach for this project.

## Breach Details
- **Rule**: ${rule.ruleName}
- **Description**: ${rule.description}
- **Current Value**: ${breach.currentValue}
- **Threshold**: ${rule.threshold} (direction: ${rule.direction})
- **Progress**: ${Math.round(breach.progress * 100)}%

## Current System Health Snapshot
${valuesStr}

## Your Task

1. Investigate the root cause of this breach
2. Check recent run logs, goal status, and job configurations
3. Look for patterns — is this a one-time issue or a trend?
4. Provide specific, actionable recommendations

## Available Actions

You have access to MCP tools for:
- Reading data tables (check metrics history, rules)
- Reading project files (check code, configs)
- Checking run histories and logs

## Output Format

Provide a concise analysis (2-4 paragraphs):
1. **Root Cause**: What's causing the breach
2. **Impact**: How this affects the project's goals
3. **Recommendation**: Specific steps to resolve the issue`;
}

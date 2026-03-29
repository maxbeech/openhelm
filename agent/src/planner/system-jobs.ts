/**
 * System Job Generation — generates monitoring/review jobs for a goal.
 * Called by the autopilot orchestrator after a user plan is committed.
 *
 * Uses Sonnet to generate high-quality prompts, but the generated system
 * jobs themselves default to Haiku with low effort for cost efficiency.
 */

import { callLlmViaCli } from "./llm-via-cli.js";
import { SYSTEM_JOB_GENERATION_PROMPT } from "./prompts.js";
import { SYSTEM_JOB_GENERATION_SCHEMA } from "./schemas.js";
import { extractJson } from "./extract-json.js";
import { getGoal } from "../db/queries/goals.js";
import { listJobs } from "../db/queries/jobs.js";
import { getProject } from "../db/queries/projects.js";
import { listTargets } from "../db/queries/targets.js";
import { evaluateTargets } from "../data-tables/target-evaluator.js";
import type { PlannedSystemJob, Job } from "@openhelm/shared";

interface SystemJobGenerationResult {
  jobs: PlannedSystemJob[];
}

/**
 * Generate system monitoring/review jobs for a goal.
 * Returns 0-3 PlannedSystemJob objects with systemCategory.
 */
export async function generateSystemJobs(
  goalId: string,
  projectId: string,
): Promise<PlannedSystemJob[]> {
  const goal = getGoal(goalId);
  if (!goal) {
    console.error(`[system-jobs] goal not found: ${goalId}`);
    return [];
  }

  const project = getProject(projectId);
  if (!project) {
    console.error(`[system-jobs] project not found: ${projectId}`);
    return [];
  }

  // Get existing user jobs for context (exclude system jobs)
  const allJobs = listJobs({ goalId });
  const userJobs = allJobs.filter((j) => j.source === "user");
  const existingSystemCategories = allJobs
    .filter((j) => j.source === "system" && j.systemCategory)
    .map((j) => j.systemCategory!);

  const now = new Date();
  const userMessage = buildUserMessage(
    goal,
    project,
    userJobs,
    existingSystemCategories,
    now,
  );

  try {
    const raw = await callLlmViaCli({
      model: "planning",
      systemPrompt: SYSTEM_JOB_GENERATION_PROMPT,
      userMessage,
      jsonSchema: SYSTEM_JOB_GENERATION_SCHEMA,
      timeoutMs: 120_000,
    });

    const jsonStr = extractJson(raw);
    const parsed = JSON.parse(jsonStr) as SystemJobGenerationResult;
    if (!parsed?.jobs || !Array.isArray(parsed.jobs)) {
      console.error("[system-jobs] invalid LLM response structure");
      return [];
    }

    // Filter out duplicates and cap at 3
    const filtered = parsed.jobs
      .filter((j) => !existingSystemCategories.includes(j.systemCategory))
      .slice(0, 3);

    console.error(
      `[system-jobs] generated ${filtered.length} system jobs for goal ${goalId}`,
    );
    return filtered;
  } catch (err) {
    console.error("[system-jobs] generation failed:", err);
    throw err;
  }
}

function buildUserMessage(
  goal: { id: string; name: string; description: string },
  project: { name: string; directoryPath: string; description: string | null },
  userJobs: Job[],
  existingCategories: string[],
  now: Date,
): string {
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const jobSummaries = userJobs
    .map((j) => `  - "${j.name}" (${j.scheduleType}): ${j.description ?? j.prompt.slice(0, 100)}`)
    .join("\n");

  const skipNote = existingCategories.length > 0
    ? `\nAlready existing system job categories (do NOT regenerate): ${existingCategories.join(", ")}`
    : "";

  return `Current datetime: ${now.toISOString()}
Timezone: ${tz}
Day of week: ${dayNames[now.getDay()]}

Project: "${project.name}"
Directory: ${project.directoryPath}
${project.description ? `Description: ${project.description}` : ""}

Goal: "${goal.name}"
${goal.description !== goal.name ? `Description: ${goal.description}` : ""}

User-created jobs for this goal:
${jobSummaries || "  (none yet)"}
${skipNote}
${buildTargetSummary(goal.id)}
Generate appropriate monitoring/review system jobs for this goal.`;
}

function buildTargetSummary(goalId: string): string {
  try {
    const targets = listTargets({ goalId });
    if (targets.length === 0) return "";

    const evaluations = evaluateTargets(targets);
    const dirLabels = { gte: ">=", lte: "<=", eq: "==" } as const;
    const lines = evaluations.map((e) => {
      const label = e.label ?? "Target";
      const dir = dirLabels[e.direction];
      const pct = Math.round(e.progress * 100);
      const current = e.currentValue != null ? e.currentValue : "no data";
      const overdue = e.isOverdue ? " OVERDUE" : "";
      return `  - ${label}: ${dir} ${e.targetValue} (current: ${current}, progress: ${pct}%${overdue})`;
    });

    return `\nTarget metrics for this goal:\n${lines.join("\n")}\n`;
  } catch {
    return "";
  }
}

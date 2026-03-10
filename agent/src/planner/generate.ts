import { callLlmViaCli } from "./llm-via-cli.js";
import { validatePlan, validatePlanCronExpressions } from "./validators.js";
import { getProject } from "../db/queries/projects.js";
import { PLAN_GENERATION_SYSTEM_PROMPT } from "./prompts.js";
import { PLAN_GENERATION_SCHEMA } from "./schemas.js";
import type { GeneratedPlan } from "@openorchestra/shared";

const JSON_PARSE_MAX_RETRIES = 1;

/**
 * Generate a plan of Claude Code jobs for a given goal.
 * Uses a single-turn CLI call with post-generation cron validation.
 * Retries once automatically on JSON parse failures (malformed LLM output).
 */
export async function generatePlan(
  projectId: string,
  goalDescription: string,
  clarificationAnswers?: Record<string, string>,
): Promise<GeneratedPlan> {
  const project = getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const userMessage = buildGenerationMessage(
    project.name,
    project.description,
    project.directoryPath,
    goalDescription,
    clarificationAnswers,
  );

  let lastError: unknown;

  for (let attempt = 0; attempt <= JSON_PARSE_MAX_RETRIES; attempt++) {
    const text = await callLlmViaCli({
      model: "planning",
      systemPrompt: PLAN_GENERATION_SYSTEM_PROMPT,
      userMessage,
      jsonSchema: PLAN_GENERATION_SCHEMA,
    });

    try {
      const plan = parsePlanResponse(text);
      validatePlanCronExpressions(plan);
      return plan;
    } catch (err) {
      lastError = err;
      if (attempt < JSON_PARSE_MAX_RETRIES) {
        console.error(
          `[planner] plan generation failed (attempt ${attempt + 1}), retrying`,
        );
      }
    }
  }

  throw lastError;
}

function buildGenerationMessage(
  projectName: string,
  projectDescription: string | null,
  directoryPath: string,
  goalDescription: string,
  clarificationAnswers?: Record<string, string>,
): string {
  const now = new Date();
  const datetimeContext = [
    `Current datetime: ${now.toISOString()}`,
    `Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    `Day of week: ${now.toLocaleDateString("en-US", { weekday: "long" })}`,
  ].join("\n");

  const parts = [
    datetimeContext,
    "",
    `Project: ${projectName}`,
    `Directory: ${directoryPath}`,
    projectDescription ? `Description: ${projectDescription}` : null,
    `\nGoal: ${goalDescription}`,
  ];

  if (clarificationAnswers && Object.keys(clarificationAnswers).length > 0) {
    parts.push("\nAdditional context from user:");
    for (const [question, answer] of Object.entries(clarificationAnswers)) {
      parts.push(`Q: ${question}\nA: ${answer}`);
    }
  }

  return parts.filter(Boolean).join("\n");
}

function parsePlanResponse(text: string): GeneratedPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `Failed to parse plan response as JSON: ${text.slice(0, 300)}`,
    );
  }

  return validatePlan(parsed);
}

import { runAgentLoop } from "../llm/loop.js";
import { PLANNING_TOOLS } from "../llm/tools.js";
import { LlmError } from "../llm/client.js";
import { getProject } from "../db/queries/projects.js";
import { PLAN_GENERATION_SYSTEM_PROMPT } from "./prompts.js";
import type {
  GeneratedPlan,
  PlannedJob,
  ScheduleType,
} from "@openorchestra/shared";

const MIN_JOBS = 2;
const MAX_JOBS = 6;
const VALID_SCHEDULE_TYPES: ScheduleType[] = ["once", "interval", "cron"];
const JSON_PARSE_MAX_RETRIES = 1;

/**
 * Generate a plan of Claude Code jobs for a given goal.
 * Uses the agent loop with tool calling (cron validation, datetime).
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
    const result = await runAgentLoop({
      model: "planning",
      system: PLAN_GENERATION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      tools: PLANNING_TOOLS,
      maxTokens: 8192,
      maxIterations: 5,
      temperature: 0.3,
    });

    try {
      return parsePlanResponse(result.text);
    } catch (err) {
      lastError = err;
      if (attempt < JSON_PARSE_MAX_RETRIES) {
        console.error(
          `[planner] plan generation JSON parse failed (attempt ${attempt + 1}), retrying`,
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
  const parts = [
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
    // Strip potential markdown fences the model might add despite instructions
    const cleaned = text.replace(/^```json?\s*\n?/m, "").replace(/\n?```\s*$/m, "");
    parsed = JSON.parse(cleaned.trim());
  } catch {
    throw new LlmError(
      `Failed to parse plan response as JSON: ${text.slice(0, 300)}`,
      "unknown",
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new LlmError("Plan response is not a JSON object", "unknown");
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.jobs)) {
    throw new LlmError("Plan response missing jobs array", "unknown");
  }

  if (obj.jobs.length < MIN_JOBS || obj.jobs.length > MAX_JOBS) {
    throw new LlmError(
      `Plan must contain ${MIN_JOBS}-${MAX_JOBS} jobs, got ${obj.jobs.length}`,
      "unknown",
    );
  }

  const jobs = obj.jobs.map(validatePlannedJob);
  return { jobs };
}

function validatePlannedJob(raw: unknown, index: number): PlannedJob {
  if (typeof raw !== "object" || raw === null) {
    throw new LlmError(`Job at index ${index} is not an object`, "unknown");
  }

  const obj = raw as Record<string, unknown>;
  const required = ["name", "description", "prompt", "rationale", "scheduleType", "scheduleConfig"];

  for (const field of required) {
    if (!obj[field] && obj[field] !== 0) {
      throw new LlmError(`Job at index ${index} missing required field: ${field}`, "unknown");
    }
  }

  if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
    throw new LlmError(`Job at index ${index} has empty name`, "unknown");
  }
  if (typeof obj.description !== "string" || obj.description.trim().length === 0) {
    throw new LlmError(`Job at index ${index} has empty description`, "unknown");
  }
  if (typeof obj.prompt !== "string" || obj.prompt.trim().length === 0) {
    throw new LlmError(`Job at index ${index} has empty prompt`, "unknown");
  }
  if (typeof obj.rationale !== "string" || obj.rationale.trim().length === 0) {
    throw new LlmError(`Job at index ${index} has empty rationale`, "unknown");
  }

  if (!VALID_SCHEDULE_TYPES.includes(obj.scheduleType as ScheduleType)) {
    throw new LlmError(
      `Job at index ${index} has invalid scheduleType: ${obj.scheduleType}`,
      "unknown",
    );
  }

  if (typeof obj.scheduleConfig !== "object" || obj.scheduleConfig === null) {
    throw new LlmError(`Job at index ${index} has invalid scheduleConfig`, "unknown");
  }

  return {
    name: (obj.name as string).trim(),
    description: (obj.description as string).trim(),
    prompt: (obj.prompt as string).trim(),
    rationale: (obj.rationale as string).trim(),
    scheduleType: obj.scheduleType as ScheduleType,
    scheduleConfig: obj.scheduleConfig as PlannedJob["scheduleConfig"],
  };
}

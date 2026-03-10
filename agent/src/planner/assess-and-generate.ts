/**
 * Combined assess + generate: a single Sonnet CLI call that decides whether
 * clarification is needed and, if not, produces the full plan. Eliminates
 * one entire CLI spawn for the common "no clarification" path (~3-8s saved).
 */

import { callLlmViaCli } from "./llm-via-cli.js";
import {
  validateQuestions,
  validatePlan,
  validatePlanCronExpressions,
} from "./validators.js";
import { getProject } from "../db/queries/projects.js";
import { ASSESS_AND_GENERATE_SYSTEM_PROMPT } from "./prompts.js";
import { ASSESS_AND_GENERATE_SCHEMA } from "./schemas.js";
import { emit } from "../ipc/emitter.js";
import type { AssessAndGenerateResult } from "@openorchestra/shared";

const JSON_PARSE_MAX_RETRIES = 1;

/**
 * Assess a goal and generate a plan in a single LLM call.
 * Returns either clarifying questions or a complete plan.
 */
export async function assessAndGenerate(
  projectId: string,
  goalDescription: string,
): Promise<AssessAndGenerateResult> {
  const project = getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const userMessage = buildMessage(
    project.name,
    project.description,
    project.directoryPath,
    goalDescription,
  );

  let lastError: unknown;

  for (let attempt = 0; attempt <= JSON_PARSE_MAX_RETRIES; attempt++) {
    const text = await callLlmViaCli({
      model: "planning",
      systemPrompt: ASSESS_AND_GENERATE_SYSTEM_PROMPT,
      userMessage,
      jsonSchema: ASSESS_AND_GENERATE_SCHEMA,
      onProgress: (chunk) => {
        emit("planner.progress", { chunk });
      },
    });

    try {
      return parseResponse(text);
    } catch (err) {
      lastError = err;
      if (attempt < JSON_PARSE_MAX_RETRIES) {
        console.error(
          `[planner] assess-and-generate parse failed (attempt ${attempt + 1}), retrying`,
        );
      }
    }
  }

  throw lastError;
}

function buildMessage(
  projectName: string,
  projectDescription: string | null,
  directoryPath: string,
  goalDescription: string,
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

  return parts.filter(Boolean).join("\n");
}

function parseResponse(text: string): AssessAndGenerateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `Failed to parse assess-and-generate response as JSON: ${text.slice(0, 300)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Response is not a JSON object");
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.needsClarification !== "boolean") {
    throw new Error("Response missing needsClarification boolean");
  }

  if (obj.needsClarification) {
    const questions = validateQuestions(obj.questions);
    return { needsClarification: true, questions };
  }

  // Validate the plan
  if (!obj.plan || typeof obj.plan !== "object") {
    throw new Error("Response missing plan object");
  }

  const plan = validatePlan(obj.plan);
  validatePlanCronExpressions(plan);

  return { needsClarification: false, plan };
}

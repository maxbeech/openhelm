import { callLlmViaCli } from "./llm-via-cli.js";
import { validateQuestions } from "./validators.js";
import { getProject } from "../db/queries/projects.js";
import { ASSESSMENT_SYSTEM_PROMPT } from "./prompts.js";
import { ASSESSMENT_SCHEMA } from "./schemas.js";
import type { AssessmentResult } from "@openorchestra/shared";

const JSON_PARSE_MAX_RETRIES = 1;

/**
 * Assess whether a goal description is specific enough to generate a plan,
 * or whether clarifying questions are needed first.
 *
 * Uses a fast classification call (not the full agent loop).
 * Retries once automatically on JSON parse failures (malformed LLM output).
 */
export async function assessGoal(
  projectId: string,
  goalDescription: string,
): Promise<AssessmentResult> {
  const project = getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const userMessage = buildAssessmentMessage(project.name, project.description, goalDescription);

  let lastError: unknown;

  for (let attempt = 0; attempt <= JSON_PARSE_MAX_RETRIES; attempt++) {
    const text = await callLlmViaCli({
      model: "classification",
      systemPrompt: ASSESSMENT_SYSTEM_PROMPT,
      userMessage,
      jsonSchema: ASSESSMENT_SCHEMA,
    });

    try {
      return parseAssessmentResponse(text);
    } catch (err) {
      lastError = err;
      if (attempt < JSON_PARSE_MAX_RETRIES) {
        console.error(
          `[planner] assessment JSON parse failed (attempt ${attempt + 1}), retrying`,
        );
      }
    }
  }

  throw lastError;
}

function buildAssessmentMessage(
  projectName: string,
  projectDescription: string | null,
  goalDescription: string,
): string {
  const parts = [
    `Project: ${projectName}`,
    projectDescription ? `Description: ${projectDescription}` : null,
    `\nGoal: ${goalDescription}`,
  ];
  return parts.filter(Boolean).join("\n");
}

function parseAssessmentResponse(text: string): AssessmentResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `Failed to parse assessment response as JSON: ${text.slice(0, 200)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Assessment response is not a JSON object");
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.needsClarification !== "boolean") {
    throw new Error("Assessment response missing needsClarification boolean");
  }

  if (!obj.needsClarification) {
    return { needsClarification: false, questions: [] };
  }

  const questions = validateQuestions(obj.questions);
  return { needsClarification: true, questions };
}

import { callLlm, LlmError } from "../llm/client.js";
import { getProject } from "../db/queries/projects.js";
import { ASSESSMENT_SYSTEM_PROMPT } from "./prompts.js";
import type { AssessmentResult, ClarifyingQuestion } from "@openorchestra/shared";

const MAX_QUESTIONS = 2;

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
    const response = await callLlm({
      model: "classification",
      system: ASSESSMENT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      maxTokens: 1024,
      temperature: 0,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new LlmError("Assessment returned no text response", "unknown");
    }

    try {
      return parseAssessmentResponse(textBlock.text);
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
    parsed = JSON.parse(text.trim());
  } catch {
    throw new LlmError(
      `Failed to parse assessment response as JSON: ${text.slice(0, 200)}`,
      "unknown",
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new LlmError("Assessment response is not a JSON object", "unknown");
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.needsClarification !== "boolean") {
    throw new LlmError("Assessment response missing needsClarification boolean", "unknown");
  }

  if (!obj.needsClarification) {
    return { needsClarification: false, questions: [] };
  }

  // Validate and cap questions
  const questions = validateQuestions(obj.questions);
  return { needsClarification: true, questions };
}

function validateQuestions(raw: unknown): ClarifyingQuestion[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }

  const questions: ClarifyingQuestion[] = [];
  for (const item of raw.slice(0, MAX_QUESTIONS)) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>).question === "string" &&
      Array.isArray((item as Record<string, unknown>).options)
    ) {
      questions.push({
        question: (item as Record<string, unknown>).question as string,
        options: ((item as Record<string, unknown>).options as unknown[])
          .filter((o) => typeof o === "string")
          .slice(0, 5) as string[],
      });
    }
  }
  return questions;
}

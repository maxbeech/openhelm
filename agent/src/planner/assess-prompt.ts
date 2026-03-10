import { callLlmViaCli } from "./llm-via-cli.js";
import { validateQuestions } from "./validators.js";
import { getProject } from "../db/queries/projects.js";
import { PROMPT_ASSESSMENT_SYSTEM_PROMPT } from "./prompts.js";
import { PROMPT_ASSESSMENT_SCHEMA } from "./schemas.js";
import type {
  PromptAssessmentResult,
} from "@openorchestra/shared";

/**
 * Assess whether a manual job prompt is specific enough to produce useful
 * results when sent to Claude Code, or whether clarifying questions are needed.
 *
 * This is a softer check than goal assessment — manual job creation implies
 * more intentionality from the user.
 */
export async function assessPrompt(
  projectId: string,
  prompt: string,
): Promise<PromptAssessmentResult> {
  const project = getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const userMessage = buildPromptAssessmentMessage(
    project.name,
    project.description,
    prompt,
  );

  const text = await callLlmViaCli({
    model: "classification",
    systemPrompt: PROMPT_ASSESSMENT_SYSTEM_PROMPT,
    userMessage,
    jsonSchema: PROMPT_ASSESSMENT_SCHEMA,
  });

  return parsePromptAssessmentResponse(text);
}

function buildPromptAssessmentMessage(
  projectName: string,
  projectDescription: string | null,
  prompt: string,
): string {
  const parts = [
    `Project: ${projectName}`,
    projectDescription ? `Description: ${projectDescription}` : null,
    `\nClaude Code prompt:\n${prompt}`,
  ];
  return parts.filter(Boolean).join("\n");
}

function parsePromptAssessmentResponse(
  text: string,
): PromptAssessmentResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `Failed to parse prompt assessment response as JSON: ${text.slice(0, 200)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(
      "Prompt assessment response is not a JSON object",
    );
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.needsClarification !== "boolean") {
    throw new Error(
      "Prompt assessment response missing needsClarification boolean",
    );
  }

  if (!obj.needsClarification) {
    return { needsClarification: false, questions: [] };
  }

  const questions = validateQuestions(obj.questions);
  return { needsClarification: true, questions };
}

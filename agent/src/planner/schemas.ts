/**
 * JSON Schema definitions for structured LLM output.
 * Used with Claude Code CLI --json-schema flag to guarantee
 * valid JSON responses, eliminating parse failures and retries.
 */

const QUESTION_SCHEMA = {
  type: "object",
  properties: {
    question: { type: "string" },
    options: { type: "array", items: { type: "string" } },
  },
  required: ["question", "options"],
} as const;

const JOB_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    prompt: { type: "string" },
    rationale: { type: "string" },
    scheduleType: { type: "string", enum: ["once", "interval", "cron"] },
    scheduleConfig: { type: "object" },
  },
  required: ["name", "description", "prompt", "rationale", "scheduleType", "scheduleConfig"],
} as const;

export const ASSESSMENT_SCHEMA = {
  type: "object",
  properties: {
    needsClarification: { type: "boolean" },
    questions: {
      type: "array",
      items: QUESTION_SCHEMA,
    },
  },
  required: ["needsClarification"],
} as const;

export const PLAN_GENERATION_SCHEMA = {
  type: "object",
  properties: {
    jobs: {
      type: "array",
      items: JOB_SCHEMA,
    },
  },
  required: ["jobs"],
} as const;

export const ASSESS_AND_GENERATE_SCHEMA = {
  type: "object",
  properties: {
    needsClarification: { type: "boolean" },
    questions: {
      type: "array",
      items: QUESTION_SCHEMA,
    },
    plan: {
      type: "object",
      properties: {
        jobs: {
          type: "array",
          items: JOB_SCHEMA,
        },
      },
      required: ["jobs"],
    },
  },
  required: ["needsClarification"],
} as const;

export const FAILURE_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    fixable: { type: "boolean" },
    correction: { type: ["string", "null"] },
    continuationPrompt: { type: ["string", "null"] },
    reason: { type: "string" },
  },
  required: ["fixable", "reason"],
} as const;

export const CORRECTION_EVALUATION_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["keep", "modify", "remove"] },
    modifiedNote: { type: ["string", "null"] },
    reason: { type: "string" },
  },
  required: ["action", "reason"],
} as const;

export const MEMORY_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    memories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["semantic", "episodic", "procedural", "source"] },
          content: { type: "string" },
          importance: { type: "number" },
          tags: { type: "array", items: { type: "string" } },
          action: { type: "string", enum: ["create", "update", "merge"] },
          mergeTargetId: { type: ["string", "null"] },
        },
        required: ["type", "content", "importance", "tags", "action"],
      },
    },
  },
  required: ["memories"],
} as const;

export const PROMPT_ASSESSMENT_SCHEMA = {
  type: "object",
  properties: {
    needsClarification: { type: "boolean" },
    questions: {
      type: "array",
      items: QUESTION_SCHEMA,
    },
  },
  required: ["needsClarification"],
} as const;

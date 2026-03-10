/**
 * Shared validation helpers for planner modules.
 * Extracted from assess.ts and generate.ts to enable reuse in
 * the combined assess-and-generate module.
 */

import { validateCronExpression } from "./cron-validator.js";
import type {
  ClarifyingQuestion,
  GeneratedPlan,
  PlannedJob,
  ScheduleType,
} from "@openorchestra/shared";

const MAX_QUESTIONS = 2;
const MIN_JOBS = 2;
const MAX_JOBS = 6;
const VALID_SCHEDULE_TYPES: ScheduleType[] = ["once", "interval", "cron"];

/** Validate and cap an array of clarifying questions */
export function validateQuestions(raw: unknown): ClarifyingQuestion[] {
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
          .filter((o) => (o as string).toLowerCase().trim() !== "something else")
          .slice(0, 5) as string[],
      });
    }
  }
  return questions;
}

/** Validate a complete plan response (jobs array with bounds check) */
export function validatePlan(parsed: unknown): GeneratedPlan {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Plan response is not a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.jobs)) {
    throw new Error("Plan response missing jobs array");
  }

  if (obj.jobs.length < MIN_JOBS || obj.jobs.length > MAX_JOBS) {
    throw new Error(
      `Plan must contain ${MIN_JOBS}-${MAX_JOBS} jobs, got ${obj.jobs.length}`,
    );
  }

  const jobs = obj.jobs.map(validatePlannedJob);
  return { jobs };
}

/** Validate a single planned job object */
export function validatePlannedJob(raw: unknown, index: number): PlannedJob {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Job at index ${index} is not an object`);
  }

  const obj = raw as Record<string, unknown>;
  const required = ["name", "description", "prompt", "rationale", "scheduleType", "scheduleConfig"];

  for (const field of required) {
    if (!obj[field] && obj[field] !== 0) {
      throw new Error(`Job at index ${index} missing required field: ${field}`);
    }
  }

  if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
    throw new Error(`Job at index ${index} has empty name`);
  }
  if (typeof obj.description !== "string" || obj.description.trim().length === 0) {
    throw new Error(`Job at index ${index} has empty description`);
  }
  if (typeof obj.prompt !== "string" || obj.prompt.trim().length === 0) {
    throw new Error(`Job at index ${index} has empty prompt`);
  }
  if (typeof obj.rationale !== "string" || obj.rationale.trim().length === 0) {
    throw new Error(`Job at index ${index} has empty rationale`);
  }

  if (!VALID_SCHEDULE_TYPES.includes(obj.scheduleType as ScheduleType)) {
    throw new Error(
      `Job at index ${index} has invalid scheduleType: ${obj.scheduleType}`,
    );
  }

  if (typeof obj.scheduleConfig !== "object" || obj.scheduleConfig === null) {
    throw new Error(`Job at index ${index} has invalid scheduleConfig`);
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

/** Validate all cron expressions in a generated plan */
export function validatePlanCronExpressions(plan: GeneratedPlan): void {
  for (let i = 0; i < plan.jobs.length; i++) {
    const job = plan.jobs[i];
    if (job.scheduleType === "cron") {
      const config = job.scheduleConfig as { expression?: string };
      if (config.expression) {
        try {
          validateCronExpression(config.expression);
        } catch {
          throw new Error(
            `Job at index ${i} has invalid cron expression: ${config.expression}`,
          );
        }
      }
    }
  }
}

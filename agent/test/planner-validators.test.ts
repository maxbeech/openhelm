import { describe, it, expect } from "vitest";
import {
  validateQuestions,
  validatePlan,
  validatePlannedJob,
  validatePlanCronExpressions,
} from "../src/planner/validators.js";

describe("validateQuestions", () => {
  it("should return empty array for non-array input", () => {
    expect(validateQuestions(null)).toEqual([]);
    expect(validateQuestions(undefined)).toEqual([]);
    expect(validateQuestions("string")).toEqual([]);
  });

  it("should return empty array for empty array", () => {
    expect(validateQuestions([])).toEqual([]);
  });

  it("should validate well-formed questions", () => {
    const raw = [
      { question: "What framework?", options: ["React", "Vue", "Angular"] },
    ];
    const result = validateQuestions(raw);
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe("What framework?");
    expect(result[0].options).toEqual(["React", "Vue", "Angular"]);
  });

  it("should cap at 2 questions", () => {
    const raw = [
      { question: "Q1?", options: ["A"] },
      { question: "Q2?", options: ["B"] },
      { question: "Q3?", options: ["C"] },
    ];
    expect(validateQuestions(raw)).toHaveLength(2);
  });

  it("should filter out 'Something else' option", () => {
    const raw = [
      { question: "Q?", options: ["A", "B", "Something else"] },
    ];
    const result = validateQuestions(raw);
    expect(result[0].options).toEqual(["A", "B"]);
  });

  it("should cap options at 5", () => {
    const raw = [
      { question: "Q?", options: ["1", "2", "3", "4", "5", "6", "7"] },
    ];
    const result = validateQuestions(raw);
    expect(result[0].options).toHaveLength(5);
  });

  it("should skip malformed question objects", () => {
    const raw = [
      { question: 123, options: ["A"] },
      { question: "Valid?", options: ["B"] },
    ];
    const result = validateQuestions(raw);
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe("Valid?");
  });
});

describe("validatePlannedJob", () => {
  const validJob = {
    name: "Test Job",
    description: "A test job",
    prompt: "Do something",
    rationale: "Because",
    scheduleType: "once",
    scheduleConfig: { fireAt: "2026-01-01T00:00:00Z" },
  };

  it("should validate a well-formed job", () => {
    const result = validatePlannedJob(validJob, 0);
    expect(result.name).toBe("Test Job");
    expect(result.scheduleType).toBe("once");
  });

  it("should trim string fields", () => {
    const result = validatePlannedJob(
      { ...validJob, name: "  Trimmed  " },
      0,
    );
    expect(result.name).toBe("Trimmed");
  });

  it("should throw on missing required field", () => {
    const { name, ...missing } = validJob;
    expect(() => validatePlannedJob(missing, 0)).toThrow("missing required field: name");
  });

  it("should throw on empty name", () => {
    expect(() => validatePlannedJob({ ...validJob, name: "" }, 0)).toThrow(
      "missing required field: name",
    );
  });

  it("should throw on invalid scheduleType", () => {
    expect(() =>
      validatePlannedJob({ ...validJob, scheduleType: "weekly" }, 0),
    ).toThrow("invalid scheduleType");
  });

  it("should throw on non-object input", () => {
    expect(() => validatePlannedJob(null, 0)).toThrow("not an object");
    expect(() => validatePlannedJob("string", 1)).toThrow("not an object");
  });
});

describe("validatePlan", () => {
  const makeJobs = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      name: `Job ${i}`,
      description: `Desc ${i}`,
      prompt: `Prompt ${i}`,
      rationale: `Rationale ${i}`,
      scheduleType: "once",
      scheduleConfig: { fireAt: "2026-01-01T00:00:00Z" },
    }));

  it("should validate a plan with 2-6 jobs", () => {
    const plan = validatePlan({ jobs: makeJobs(3) });
    expect(plan.jobs).toHaveLength(3);
  });

  it("should reject fewer than 2 jobs", () => {
    expect(() => validatePlan({ jobs: makeJobs(1) })).toThrow("2-6 jobs");
  });

  it("should reject more than 6 jobs", () => {
    expect(() => validatePlan({ jobs: makeJobs(7) })).toThrow("2-6 jobs");
  });

  it("should throw on missing jobs array", () => {
    expect(() => validatePlan({})).toThrow("missing jobs array");
  });

  it("should throw on non-object input", () => {
    expect(() => validatePlan(null)).toThrow("not a JSON object");
  });
});

describe("validatePlanCronExpressions", () => {
  it("should pass for valid cron expressions", () => {
    const plan = {
      jobs: [
        {
          name: "Cron Job",
          description: "d",
          prompt: "p",
          rationale: "r",
          scheduleType: "cron" as const,
          scheduleConfig: { expression: "0 9 * * 1" },
        },
        {
          name: "Once Job",
          description: "d",
          prompt: "p",
          rationale: "r",
          scheduleType: "once" as const,
          scheduleConfig: { fireAt: "2026-01-01T00:00:00Z" },
        },
      ],
    };
    expect(() => validatePlanCronExpressions(plan)).not.toThrow();
  });

  it("should throw for invalid cron expressions", () => {
    const plan = {
      jobs: [
        {
          name: "Bad Cron",
          description: "d",
          prompt: "p",
          rationale: "r",
          scheduleType: "cron" as const,
          scheduleConfig: { expression: "invalid cron" },
        },
        {
          name: "Good Job",
          description: "d",
          prompt: "p",
          rationale: "r",
          scheduleType: "once" as const,
          scheduleConfig: { fireAt: "2026-01-01T00:00:00Z" },
        },
      ],
    };
    expect(() => validatePlanCronExpressions(plan)).toThrow("invalid cron expression");
  });
});

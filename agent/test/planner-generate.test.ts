import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { setSetting } from "../src/db/queries/settings.js";

const callLlmViaCliMock = vi.fn();

vi.mock("../src/planner/llm-via-cli.js", () => ({
  callLlmViaCli: (...args: unknown[]) => callLlmViaCliMock(...args),
}));

import { generatePlan } from "../src/planner/generate.js";

let cleanup: () => void;
let projectId: string;

const VALID_PLAN = {
  jobs: [
    {
      name: "Analyze test coverage",
      description: "Scan the codebase and report current test coverage",
      prompt: "Analyze the test coverage in this project. Look at src/ and report which files lack tests.",
      rationale: "Understanding current coverage is the first step to improving it.",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    },
    {
      name: "Add missing unit tests",
      description: "Write tests for uncovered utility functions",
      prompt: "Write unit tests for any utility functions in src/utils/ that lack test coverage.",
      rationale: "Utility functions are easy targets for increasing coverage.",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    },
    {
      name: "Weekly test coverage check",
      description: "Run test coverage report weekly",
      prompt: "Run the test suite with coverage reporting. If coverage has decreased, identify the files responsible.",
      rationale: "Ongoing monitoring prevents coverage regression.",
      scheduleType: "cron",
      scheduleConfig: { expression: "0 9 * * 1" },
    },
  ],
};

beforeAll(() => {
  cleanup = setupTestDb();
  setSetting("claude_code_path", "/usr/bin/claude");
  const project = createProject({
    name: "Generate Test Project",
    description: "A TypeScript project",
    directoryPath: "/tmp/gen-test",
  });
  projectId = project.id;
});

afterAll(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generatePlan", () => {
  it("should parse a valid plan response", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(JSON.stringify(VALID_PLAN));

    const plan = await generatePlan(projectId, "Improve test coverage");

    expect(plan.jobs).toHaveLength(3);
    expect(plan.jobs[0].name).toBe("Analyze test coverage");
    expect(plan.jobs[0].scheduleType).toBe("once");
    expect(plan.jobs[2].scheduleType).toBe("cron");
  });

  it("should validate all required fields on each job", async () => {
    const invalidPlan = {
      jobs: [
        { name: "Job 1" }, // missing fields
        { name: "Job 2", description: "d", prompt: "p", rationale: "r", scheduleType: "once", scheduleConfig: {} },
      ],
    };

    callLlmViaCliMock.mockResolvedValueOnce(JSON.stringify(invalidPlan));
    callLlmViaCliMock.mockResolvedValueOnce(JSON.stringify(invalidPlan)); // retry also fails

    await expect(
      generatePlan(projectId, "Do something"),
    ).rejects.toThrow("missing required field");
  });

  it("should reject plans with fewer than 2 jobs", async () => {
    const tooFew = {
      jobs: [
        {
          name: "Single Job",
          description: "Only one",
          prompt: "Do it",
          rationale: "Because",
          scheduleType: "once",
          scheduleConfig: { fireAt: new Date().toISOString() },
        },
      ],
    };

    callLlmViaCliMock.mockResolvedValueOnce(JSON.stringify(tooFew));
    callLlmViaCliMock.mockResolvedValueOnce(JSON.stringify(tooFew)); // retry also fails

    await expect(
      generatePlan(projectId, "Simple goal"),
    ).rejects.toThrow("2-6 jobs");
  });

  it("should reject plans with more than 6 jobs", async () => {
    const tooMany = {
      jobs: Array.from({ length: 7 }, (_, i) => ({
        name: `Job ${i + 1}`,
        description: `Description ${i + 1}`,
        prompt: `Prompt ${i + 1}`,
        rationale: `Rationale ${i + 1}`,
        scheduleType: "once",
        scheduleConfig: { fireAt: new Date().toISOString() },
      })),
    };

    callLlmViaCliMock.mockResolvedValueOnce(JSON.stringify(tooMany));
    callLlmViaCliMock.mockResolvedValueOnce(JSON.stringify(tooMany)); // retry also fails

    await expect(
      generatePlan(projectId, "Lots of jobs"),
    ).rejects.toThrow("2-6 jobs");
  });

  it("should reject jobs with invalid scheduleType", async () => {
    const badSchedule = {
      jobs: [
        {
          name: "Job 1",
          description: "d",
          prompt: "p",
          rationale: "r",
          scheduleType: "weekly",
          scheduleConfig: {},
        },
        {
          name: "Job 2",
          description: "d",
          prompt: "p",
          rationale: "r",
          scheduleType: "once",
          scheduleConfig: { fireAt: new Date().toISOString() },
        },
      ],
    };

    callLlmViaCliMock.mockResolvedValueOnce(JSON.stringify(badSchedule));
    callLlmViaCliMock.mockResolvedValueOnce(JSON.stringify(badSchedule)); // retry also fails

    await expect(
      generatePlan(projectId, "Invalid schedule"),
    ).rejects.toThrow("invalid scheduleType");
  });

  it("should reject jobs with empty name/description/prompt/rationale", async () => {
    const emptyFields = {
      jobs: [
        {
          name: "",
          description: "d",
          prompt: "p",
          rationale: "r",
          scheduleType: "once",
          scheduleConfig: { fireAt: new Date().toISOString() },
        },
        {
          name: "Valid",
          description: "d",
          prompt: "p",
          rationale: "r",
          scheduleType: "once",
          scheduleConfig: { fireAt: new Date().toISOString() },
        },
      ],
    };

    callLlmViaCliMock.mockResolvedValueOnce(JSON.stringify(emptyFields));
    callLlmViaCliMock.mockResolvedValueOnce(JSON.stringify(emptyFields)); // retry also fails

    await expect(
      generatePlan(projectId, "Empty fields"),
    ).rejects.toThrow("missing required field");
  });

  it("should pass jsonSchema to the LLM call", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(JSON.stringify(VALID_PLAN));

    await generatePlan(projectId, "Test coverage");

    expect(callLlmViaCliMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jsonSchema: expect.objectContaining({
          type: "object",
          required: ["jobs"],
        }),
      }),
    );
  });

  it("should throw on non-existent project", async () => {
    await expect(
      generatePlan("fake-id", "Goal"),
    ).rejects.toThrow("Project not found");
  });

  it("should include clarification answers in message", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(JSON.stringify(VALID_PLAN));

    await generatePlan(projectId, "Improve code", {
      "What type?": "Performance",
    });

    const callArgs = callLlmViaCliMock.mock.calls[0][0];
    expect(callArgs.userMessage).toContain("What type?");
    expect(callArgs.userMessage).toContain("Performance");
  });

  it("should use planning model", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(JSON.stringify(VALID_PLAN));

    await generatePlan(projectId, "Test");

    expect(callLlmViaCliMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "planning",
      }),
    );
  });

  it("should include datetime context in the message", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(JSON.stringify(VALID_PLAN));

    await generatePlan(projectId, "Test");

    const callArgs = callLlmViaCliMock.mock.calls[0][0];
    expect(callArgs.userMessage).toContain("Current datetime:");
    expect(callArgs.userMessage).toContain("Timezone:");
    expect(callArgs.userMessage).toContain("Day of week:");
  });

  it("should validate cron expressions and reject invalid ones", async () => {
    const planWithBadCron = {
      jobs: [
        {
          name: "Job 1",
          description: "d",
          prompt: "p",
          rationale: "r",
          scheduleType: "once",
          scheduleConfig: { fireAt: new Date().toISOString() },
        },
        {
          name: "Bad cron job",
          description: "d",
          prompt: "p",
          rationale: "r",
          scheduleType: "cron",
          scheduleConfig: { expression: "invalid cron" },
        },
      ],
    };

    callLlmViaCliMock.mockResolvedValueOnce(JSON.stringify(planWithBadCron));
    callLlmViaCliMock.mockResolvedValueOnce(JSON.stringify(planWithBadCron)); // retry

    await expect(
      generatePlan(projectId, "Bad cron"),
    ).rejects.toThrow("invalid cron expression");
  });
});

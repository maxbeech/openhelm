import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { setSetting } from "../src/db/queries/settings.js";

const callLlmViaCliMock = vi.fn();

vi.mock("../src/planner/llm-via-cli.js", () => ({
  callLlmViaCli: (...args: unknown[]) => callLlmViaCliMock(...args),
}));

vi.mock("../src/ipc/emitter.js", () => ({
  emit: vi.fn(),
}));

import { assessAndGenerate } from "../src/planner/assess-and-generate.js";

let cleanup: () => void;
let projectId: string;

const VALID_PLAN_RESPONSE = JSON.stringify({
  needsClarification: false,
  plan: {
    jobs: [
      {
        name: "Analyze code",
        description: "Scan the codebase for issues",
        prompt: "Look at all source files and identify code quality issues.",
        rationale: "First step is understanding current state.",
        scheduleType: "once",
        scheduleConfig: { fireAt: new Date().toISOString() },
      },
      {
        name: "Fix issues",
        description: "Fix identified code quality issues",
        prompt: "Fix the top code quality issues found in the codebase.",
        rationale: "Directly addresses the goal.",
        scheduleType: "once",
        scheduleConfig: { fireAt: new Date().toISOString() },
      },
    ],
  },
});

const CLARIFICATION_RESPONSE = JSON.stringify({
  needsClarification: true,
  questions: [
    {
      question: "What area of the codebase?",
      options: ["Frontend", "Backend", "Both"],
    },
  ],
});

beforeAll(() => {
  cleanup = setupTestDb();
  setSetting("claude_code_path", "/usr/bin/claude");
  const project = createProject({
    name: "Combined Test Project",
    description: "A project for combined testing",
    directoryPath: "/tmp/combined-test",
  });
  projectId = project.id;
});

afterAll(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assessAndGenerate", () => {
  it("should return plan when no clarification needed", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(VALID_PLAN_RESPONSE);

    const result = await assessAndGenerate(projectId, "Improve code quality");

    expect(result.needsClarification).toBe(false);
    if (!result.needsClarification) {
      expect(result.plan.jobs).toHaveLength(2);
      expect(result.plan.jobs[0].name).toBe("Analyze code");
    }
  });

  it("should return questions when clarification needed", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(CLARIFICATION_RESPONSE);

    const result = await assessAndGenerate(projectId, "Improve things");

    expect(result.needsClarification).toBe(true);
    if (result.needsClarification) {
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0].question).toContain("area");
    }
  });

  it("should use planning model tier (Sonnet)", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(VALID_PLAN_RESPONSE);

    await assessAndGenerate(projectId, "Clear goal");

    expect(callLlmViaCliMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "planning",
      }),
    );
  });

  it("should include datetime context in message", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(VALID_PLAN_RESPONSE);

    await assessAndGenerate(projectId, "Test goal");

    const callArgs = callLlmViaCliMock.mock.calls[0][0];
    expect(callArgs.userMessage).toContain("Current datetime:");
    expect(callArgs.userMessage).toContain("Timezone:");
    expect(callArgs.userMessage).toContain("Day of week:");
  });

  it("should include project context in message", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(VALID_PLAN_RESPONSE);

    await assessAndGenerate(projectId, "Test goal");

    const callArgs = callLlmViaCliMock.mock.calls[0][0];
    expect(callArgs.userMessage).toContain("Combined Test Project");
    expect(callArgs.userMessage).toContain("/tmp/combined-test");
    expect(callArgs.userMessage).toContain("Test goal");
  });

  it("should pass jsonSchema to LLM call", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(VALID_PLAN_RESPONSE);

    await assessAndGenerate(projectId, "Test goal");

    expect(callLlmViaCliMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jsonSchema: expect.objectContaining({
          type: "object",
          required: ["needsClarification"],
        }),
      }),
    );
  });

  it("should pass onProgress callback", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(VALID_PLAN_RESPONSE);

    await assessAndGenerate(projectId, "Test goal");

    expect(callLlmViaCliMock).toHaveBeenCalledWith(
      expect.objectContaining({
        onProgress: expect.any(Function),
      }),
    );
  });

  it("should throw on non-existent project", async () => {
    await expect(
      assessAndGenerate("fake-id", "Goal"),
    ).rejects.toThrow("Project not found");
  });

  it("should throw on invalid JSON after retries", async () => {
    callLlmViaCliMock.mockResolvedValueOnce("not json");
    callLlmViaCliMock.mockResolvedValueOnce("still not json");

    await expect(
      assessAndGenerate(projectId, "Goal"),
    ).rejects.toThrow("Failed to parse");
  });

  it("should throw when plan path missing plan object", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(
      JSON.stringify({ needsClarification: false }),
    );
    callLlmViaCliMock.mockResolvedValueOnce(
      JSON.stringify({ needsClarification: false }),
    );

    await expect(
      assessAndGenerate(projectId, "Goal"),
    ).rejects.toThrow("missing plan object");
  });

  it("should validate cron expressions in plan", async () => {
    const badCronResponse = JSON.stringify({
      needsClarification: false,
      plan: {
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
            name: "Bad cron",
            description: "d",
            prompt: "p",
            rationale: "r",
            scheduleType: "cron",
            scheduleConfig: { expression: "not a cron" },
          },
        ],
      },
    });

    callLlmViaCliMock.mockResolvedValueOnce(badCronResponse);
    callLlmViaCliMock.mockResolvedValueOnce(badCronResponse);

    await expect(
      assessAndGenerate(projectId, "Goal"),
    ).rejects.toThrow("invalid cron expression");
  });
});

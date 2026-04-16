import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { setSetting } from "../src/db/queries/settings.js";

const callLlmViaCliMock = vi.fn();

vi.mock("../src/planner/llm-via-cli.js", () => ({
  callLlmViaCli: (...args: unknown[]) => callLlmViaCliMock(...args),
}));

import { assessGoal } from "../src/planner/assess.js";

let cleanup: () => void;
let projectId: string;

beforeAll(() => {
  cleanup = setupTestDb();
  setSetting("claude_code_path", "/usr/bin/claude");
  const project = createProject({
    name: "Test Project",
    description: "A TypeScript web application",
    directoryPath: "/tmp/test-project",
  });
  projectId = project.id;
});

afterAll(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assessPrompt", () => {
  it("should return no clarification for a specific prompt", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(
      { text: JSON.stringify({ needsClarification: false }), sessionId: null },
    );

    const result = await assessGoal(
      projectId,
      "Run npm test and fix any failing tests in src/utils/",
    );
    expect(result.needsClarification).toBe(false);
    expect(result.questions).toEqual([]);
  });

  it("should return clarifying questions for a vague prompt", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(
      { text: JSON.stringify({
        needsClarification: true,
        questions: [
          {
            question: "What specifically should be refactored?",
            options: [
              "Improve type safety",
              "Reduce code duplication",
              "Extract shared utilities",
            ],
          },
        ],
      }), sessionId: null },
    );

    const result = await assessGoal(projectId, "refactor the code");
    expect(result.needsClarification).toBe(true);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].question).toContain("refactored");
    expect(result.questions[0].options.length).toBeGreaterThanOrEqual(2);
  });

  it("should cap questions at 2", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(
      { text: JSON.stringify({
        needsClarification: true,
        questions: [
          { question: "Q1?", options: ["A", "B"] },
          { question: "Q2?", options: ["C", "D"] },
          { question: "Q3?", options: ["E", "F"] },
        ],
      }), sessionId: null },
    );

    const result = await assessGoal(projectId, "Vague prompt");
    expect(result.questions.length).toBeLessThanOrEqual(2);
  });

  it("should throw on non-existent project", async () => {
    await expect(
      assessGoal("non-existent-id", "Some prompt"),
    ).rejects.toThrow("Project not found");
  });

  it("should throw on invalid JSON response", async () => {
    // Set up two mocks because assess.ts retries on JSON parse failures
    callLlmViaCliMock.mockResolvedValueOnce({ text: "Not valid JSON", sessionId: null });
    callLlmViaCliMock.mockResolvedValueOnce({ text: "Still not valid JSON", sessionId: null });

    await expect(
      assessGoal(projectId, "Some prompt"),
    ).rejects.toThrow("Failed to parse");
  });

  it("should throw when response missing needsClarification", async () => {
    // Set up two mocks because assess.ts retries on parsing failures (though this will fail on validation)
    callLlmViaCliMock.mockResolvedValueOnce({ text: JSON.stringify({ foo: "bar" }), sessionId: null });
    callLlmViaCliMock.mockResolvedValueOnce({ text: JSON.stringify({ bar: "baz" }), sessionId: null });

    await expect(
      assessGoal(projectId, "Some prompt"),
    ).rejects.toThrow("needsClarification");
  });

  it("should use classification model tier", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(
      { text: JSON.stringify({ needsClarification: false }), sessionId: null },
    );

    await assessGoal(projectId, "Run all tests");

    expect(callLlmViaCliMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "classification",
      }),
    );
  });

  it("should include project context and prompt in the message", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(
      { text: JSON.stringify({ needsClarification: false }), sessionId: null },
    );

    await assessGoal(projectId, "Fix linting errors");

    const callArgs = callLlmViaCliMock.mock.calls[0][0];
    expect(callArgs.userMessage).toContain("Test Project");
    expect(callArgs.userMessage).toContain("TypeScript web application");
    expect(callArgs.userMessage).toContain("Fix linting errors");
  });

  it("should handle empty questions array gracefully", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(
      { text: JSON.stringify({
        needsClarification: true,
        questions: [],
      }), sessionId: null },
    );

    const result = await assessGoal(projectId, "Vague prompt");
    expect(result.needsClarification).toBe(true);
    expect(result.questions).toEqual([]);
  });
});

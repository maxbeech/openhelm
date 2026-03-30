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
    description: "A project for testing",
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

describe("assessGoal", () => {
  it("should return no clarification for a specific goal", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(
      { text: JSON.stringify({ needsClarification: false }), sessionId: null },
    );

    const result = await assessGoal(projectId, "Add unit tests for all utility functions in src/utils/");
    expect(result.needsClarification).toBe(false);
    expect(result.questions).toEqual([]);
  });

  it("should return clarifying questions for a vague goal", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(
      { text: JSON.stringify({
        needsClarification: true,
        questions: [
          {
            question: "What type of improvements are you looking for?",
            options: [
              "Performance optimization",
              "Code quality and readability",
              "Test coverage",
              "Something else",
            ],
          },
        ],
      }), sessionId: null },
    );

    const result = await assessGoal(projectId, "Improve the codebase");
    expect(result.needsClarification).toBe(true);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].question).toContain("improvements");
    expect(result.questions[0].options.length).toBeGreaterThanOrEqual(2);
  });

  it("should cap questions at 2 even if model returns more", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(
      { text: JSON.stringify({
        needsClarification: true,
        questions: [
          { question: "Q1?", options: ["A", "B"] },
          { question: "Q2?", options: ["C", "D"] },
          { question: "Q3?", options: ["E", "F"] },
          { question: "Q4?", options: ["G", "H"] },
        ],
      }), sessionId: null },
    );

    const result = await assessGoal(projectId, "Vague goal");
    expect(result.questions.length).toBeLessThanOrEqual(2);
  });

  it("should throw on non-existent project", async () => {
    await expect(
      assessGoal("non-existent-id", "Some goal"),
    ).rejects.toThrow("Project not found");
  });

  it("should throw on invalid JSON response after retry", async () => {
    callLlmViaCliMock.mockResolvedValueOnce({ text: "This is not JSON", sessionId: null });
    callLlmViaCliMock.mockResolvedValueOnce({ text: "This is not JSON", sessionId: null }); // retry also fails

    await expect(
      assessGoal(projectId, "Some goal"),
    ).rejects.toThrow("Failed to parse assessment response");
  });

  it("should throw when response missing needsClarification after retry", async () => {
    callLlmViaCliMock.mockResolvedValueOnce({ text: JSON.stringify({ foo: "bar" }), sessionId: null });
    callLlmViaCliMock.mockResolvedValueOnce({ text: JSON.stringify({ foo: "bar" }), sessionId: null }); // retry also fails

    await expect(
      assessGoal(projectId, "Some goal"),
    ).rejects.toThrow("missing needsClarification");
  });

  it("should use classification model tier", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(
      { text: JSON.stringify({ needsClarification: false }), sessionId: null },
    );

    await assessGoal(projectId, "Specific goal");

    expect(callLlmViaCliMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "classification",
      }),
    );
  });

  it("should include project context in the message", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(
      { text: JSON.stringify({ needsClarification: false }), sessionId: null },
    );

    await assessGoal(projectId, "Add tests");

    const callArgs = callLlmViaCliMock.mock.calls[0][0];
    expect(callArgs.userMessage).toContain("Test Project");
    expect(callArgs.userMessage).toContain("A project for testing");
    expect(callArgs.userMessage).toContain("Add tests");
  });

  it("should handle empty questions array gracefully", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(
      { text: JSON.stringify({
        needsClarification: true,
        questions: [],
      }), sessionId: null },
    );

    const result = await assessGoal(projectId, "Vague goal");
    expect(result.needsClarification).toBe(true);
    expect(result.questions).toEqual([]);
  });
});

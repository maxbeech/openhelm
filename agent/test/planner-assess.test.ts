import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { setSetting } from "../src/db/queries/settings.js";

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: createMock };
    constructor() {}
  }
  MockAnthropic.AuthenticationError = class extends Error {};
  MockAnthropic.RateLimitError = class extends Error {};
  MockAnthropic.BadRequestError = class extends Error {};
  MockAnthropic.APIConnectionError = class extends Error {};
  MockAnthropic.APIConnectionTimeoutError = class extends Error {};
  MockAnthropic.InternalServerError = class extends Error {};
  return { default: MockAnthropic };
});

import { assessGoal } from "../src/planner/assess.js";

let cleanup: () => void;
let projectId: string;

beforeAll(() => {
  cleanup = setupTestDb();
  setSetting("anthropic_api_key", "test-key-assess");
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
    createMock.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({ needsClarification: false }),
        },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 50, output_tokens: 20 },
    });

    const result = await assessGoal(projectId, "Add unit tests for all utility functions in src/utils/");
    expect(result.needsClarification).toBe(false);
    expect(result.questions).toEqual([]);
  });

  it("should return clarifying questions for a vague goal", async () => {
    createMock.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
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
          }),
        },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 50, output_tokens: 100 },
    });

    const result = await assessGoal(projectId, "Improve the codebase");
    expect(result.needsClarification).toBe(true);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].question).toContain("improvements");
    expect(result.questions[0].options.length).toBeGreaterThanOrEqual(2);
  });

  it("should cap questions at 2 even if model returns more", async () => {
    createMock.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            needsClarification: true,
            questions: [
              { question: "Q1?", options: ["A", "B"] },
              { question: "Q2?", options: ["C", "D"] },
              { question: "Q3?", options: ["E", "F"] },
              { question: "Q4?", options: ["G", "H"] },
            ],
          }),
        },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 50, output_tokens: 150 },
    });

    const result = await assessGoal(projectId, "Vague goal");
    expect(result.questions.length).toBeLessThanOrEqual(2);
  });

  it("should throw on non-existent project", async () => {
    await expect(
      assessGoal("non-existent-id", "Some goal"),
    ).rejects.toThrow("Project not found");
  });

  it("should throw on invalid JSON response after retry", async () => {
    const badResponse = {
      content: [{ type: "text", text: "This is not JSON" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 10 },
    };
    createMock.mockResolvedValueOnce(badResponse);
    createMock.mockResolvedValueOnce(badResponse); // retry also fails

    await expect(
      assessGoal(projectId, "Some goal"),
    ).rejects.toThrow("Failed to parse assessment response");
  });

  it("should throw when response missing needsClarification after retry", async () => {
    const badResponse = {
      content: [{ type: "text", text: JSON.stringify({ foo: "bar" }) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 10 },
    };
    createMock.mockResolvedValueOnce(badResponse);
    createMock.mockResolvedValueOnce(badResponse); // retry also fails

    await expect(
      assessGoal(projectId, "Some goal"),
    ).rejects.toThrow("missing needsClarification");
  });

  it("should use classification model tier", async () => {
    createMock.mockResolvedValueOnce({
      content: [
        { type: "text", text: JSON.stringify({ needsClarification: false }) },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 10 },
    });

    await assessGoal(projectId, "Specific goal");

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-haiku-4-5-20251001",
        temperature: 0,
      }),
    );
  });

  it("should include project context in the message", async () => {
    createMock.mockResolvedValueOnce({
      content: [
        { type: "text", text: JSON.stringify({ needsClarification: false }) },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 10 },
    });

    await assessGoal(projectId, "Add tests");

    const callArgs = createMock.mock.calls[0][0];
    const userMessage = callArgs.messages[0].content;
    expect(userMessage).toContain("Test Project");
    expect(userMessage).toContain("A project for testing");
    expect(userMessage).toContain("Add tests");
  });

  it("should handle empty questions array gracefully", async () => {
    createMock.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            needsClarification: true,
            questions: [],
          }),
        },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 10 },
    });

    const result = await assessGoal(projectId, "Vague goal");
    expect(result.needsClarification).toBe(true);
    expect(result.questions).toEqual([]);
  });
});

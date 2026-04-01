import { describe, it, expect } from "vitest";
import { parseLlmResponse, buildTextResponse } from "../src/chat/response-parser.js";

describe("parseLlmResponse", () => {
  it("returns plain text with no tool calls", () => {
    const result = parseLlmResponse("Hello, how can I help?");
    expect(result.hasToolCalls).toBe(false);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.textSegments).toEqual(["Hello, how can I help?"]);
  });

  it("parses a single tool call", () => {
    const text = `<tool_call>{"tool":"list_goals","args":{}}</tool_call>`;
    const result = parseLlmResponse(text);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].tool).toBe("list_goals");
    expect(result.toolCalls[0].args).toEqual({});
    expect(result.toolCalls[0].id).toBeDefined();
  });

  it("parses tool call with args", () => {
    const text = `<tool_call>{"tool":"get_goal","args":{"goalId":"abc-123"}}</tool_call>`;
    const result = parseLlmResponse(text);
    expect(result.toolCalls[0].tool).toBe("get_goal");
    expect(result.toolCalls[0].args).toEqual({ goalId: "abc-123" });
  });

  it("captures text before and after a tool call", () => {
    const text = `I'll look that up.\n<tool_call>{"tool":"list_goals","args":{}}</tool_call>\nHere are the results.`;
    const result = parseLlmResponse(text);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.textSegments).toHaveLength(2);
    expect(result.textSegments[0]).toContain("look that up");
    expect(result.textSegments[1]).toContain("Here are the results");
  });

  it("parses multiple sequential tool calls", () => {
    const text = [
      `<tool_call>{"tool":"list_goals","args":{}}</tool_call>`,
      `<tool_call>{"tool":"list_jobs","args":{"goalId":"g1"}}</tool_call>`,
    ].join("\n");
    const result = parseLlmResponse(text);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].tool).toBe("list_goals");
    expect(result.toolCalls[1].tool).toBe("list_jobs");
  });

  it("assigns unique IDs to each tool call", () => {
    const text = [
      `<tool_call>{"tool":"list_goals","args":{}}</tool_call>`,
      `<tool_call>{"tool":"list_jobs","args":{}}</tool_call>`,
    ].join("\n");
    const result = parseLlmResponse(text);
    expect(result.toolCalls[0].id).not.toBe(result.toolCalls[1].id);
  });

  it("skips malformed JSON inside tool_call", () => {
    const text = `<tool_call>NOT VALID JSON</tool_call>`;
    const result = parseLlmResponse(text);
    expect(result.hasToolCalls).toBe(false);
    expect(result.toolCalls).toHaveLength(0);
  });

  it("handles tool call with missing args field (defaults to {})", () => {
    const text = `<tool_call>{"tool":"list_goals"}</tool_call>`;
    const result = parseLlmResponse(text);
    expect(result.toolCalls[0].args).toEqual({});
  });

  it("handles multiline tool call JSON", () => {
    const text = `<tool_call>\n{\n  "tool": "create_goal",\n  "args": {"name": "Test"}\n}\n</tool_call>`;
    const result = parseLlmResponse(text);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls[0].tool).toBe("create_goal");
    expect(result.toolCalls[0].args).toEqual({ name: "Test" });
  });

  it("returns empty result for empty string", () => {
    const result = parseLlmResponse("");
    expect(result.hasToolCalls).toBe(false);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.textSegments).toHaveLength(0);
  });

  it("handles whitespace-only string", () => {
    const result = parseLlmResponse("   ");
    expect(result.hasToolCalls).toBe(false);
    expect(result.textSegments).toHaveLength(0);
  });

  it("repairs literal newlines inside JSON string values", () => {
    // LLMs often emit literal newlines in long prompt fields instead of \\n
    const text = `<tool_call>{"tool": "create_job", "args": {"name": "Audit", "prompt": "Step 1: Review code\nStep 2: Run tests\n\n## Results\nDone"}}</tool_call>`;
    const result = parseLlmResponse(text);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].tool).toBe("create_job");
    expect(result.toolCalls[0].args.prompt).toBe("Step 1: Review code\nStep 2: Run tests\n\n## Results\nDone");
  });

  it("parses goal + jobs with literal newlines in job prompts", () => {
    const text = [
      `I'll set this up.`,
      `<tool_call>{"tool": "create_goal", "args": {"name": "Keep browser stealth"}}</tool_call>`,
      `<tool_call>{"tool": "create_job", "args": {"name": "Audit", "goalId": "pending", "prompt": "Check these:\n- bot.sannysoft.com\n- pixelscan.net"}}</tool_call>`,
    ].join("\n");
    const result = parseLlmResponse(text);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].tool).toBe("create_goal");
    expect(result.toolCalls[1].tool).toBe("create_job");
    expect(result.toolCalls[1].args.prompt).toContain("bot.sannysoft.com");
  });
});

describe("buildTextResponse", () => {
  it("joins segments with double newline", () => {
    const result = buildTextResponse(["First part", "Second part"]);
    expect(result).toBe("First part\n\nSecond part");
  });

  it("returns empty string for empty array", () => {
    expect(buildTextResponse([])).toBe("");
  });

  it("returns single segment unchanged", () => {
    expect(buildTextResponse(["Hello"])).toBe("Hello");
  });

  it("trims surrounding whitespace", () => {
    expect(buildTextResponse(["  Hello  "])).toBe("Hello");
  });
});

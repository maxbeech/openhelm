import { describe, it, expect } from "vitest";
import { parseStreamLine } from "../src/claude-code/stream-parser.js";

describe("parseStreamLine", () => {
  it("parses a text assistant message", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello, how can I help?" }],
      },
    });

    const result = parseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("Hello, how can I help?");
    expect(result!.isResult).toBe(false);
  });

  it("parses a tool_use assistant message", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Read",
            id: "toolu_123",
            input: { file_path: "/src/main.ts" },
          },
        ],
      },
    });

    const result = parseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("[Tool: Read]");
    expect(result!.isResult).toBe(false);
  });

  it("parses mixed content blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Let me check that file." },
          {
            type: "tool_use",
            name: "Read",
            id: "toolu_123",
            input: { file_path: "/src/main.ts" },
          },
        ],
      },
    });

    const result = parseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("Let me check that file.\n[Tool: Read]");
    // assistantText must exclude the [Tool: Read] marker — it is the clean
    // prose stream used by chat UIs.
    expect(result!.assistantText).toBe("Let me check that file.");
  });

  it("assistantText excludes tool_result content from user turns", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_123",
            content: "file contents: very long output that must not leak to chat",
          },
        ],
      },
    });

    const result = parseStreamLine(line);
    expect(result).not.toBeNull();
    // `text` (for run logs) still carries the tool_result text…
    expect(result!.text).toContain("very long output");
    // …but `assistantText` is undefined for user turns, so chat never sees it.
    expect(result!.assistantText).toBeUndefined();
  });

  it("assistantText excludes [Tool: name] markers for tool-only assistant turns", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Bash",
            id: "toolu_456",
            input: { command: "ls" },
          },
        ],
      },
    });

    const result = parseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("[Tool: Bash]");
    expect(result!.assistantText).toBeUndefined();
  });

  it("parses a result message", () => {
    const line = JSON.stringify({
      type: "result",
      result: "Task completed successfully.",
      cost_usd: 0.05,
      duration_ms: 12345,
      num_turns: 3,
    });

    const result = parseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("Task completed successfully.");
    expect(result!.isResult).toBe(true);
    expect(result!.costUsd).toBe(0.05);
    expect(result!.durationMs).toBe(12345);
    expect(result!.numTurns).toBe(3);
  });

  it("surfaces the error text and isError=true for an error result", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "error_max_turns",
      is_error: true,
      error: "Prompt is too long",
      result: "",
      session_id: "sess-abc",
    });

    const result = parseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.isResult).toBe(true);
    expect(result!.isError).toBe(true);
    expect(result!.text).toBe("Prompt is too long");
    expect(result!.sessionId).toBe("sess-abc");
  });

  it("defaults isError to false for a successful result", () => {
    const line = JSON.stringify({
      type: "result",
      result: "All done.",
    });

    const result = parseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.isError).toBe(false);
  });

  it("extracts token counts from result usage object", () => {
    const line = JSON.stringify({
      type: "result",
      result: "Done.",
      cost_usd: 0.01,
      usage: {
        input_tokens: 1234,
        output_tokens: 567,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });

    const result = parseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(1234);
    expect(result!.outputTokens).toBe(567);
  });

  it("returns undefined tokens when usage object is absent", () => {
    const line = JSON.stringify({
      type: "result",
      result: "Done.",
      cost_usd: 0.01,
    });

    const result = parseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBeUndefined();
    expect(result!.outputTokens).toBeUndefined();
  });

  it("parses a user message with tool_result", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_123",
            content: "file contents here",
          },
        ],
      },
    });

    const result = parseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("file contents here");
  });

  it("truncates long tool results", () => {
    const longContent = "x".repeat(600);
    const line = JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_123",
            content: longContent,
          },
        ],
      },
    });

    const result = parseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text.length).toBeLessThan(600);
    expect(result!.text).toContain("(truncated)");
  });

  it("returns null for system messages", () => {
    const line = JSON.stringify({
      type: "system",
      message: { text: "System initialization" },
    });

    const result = parseStreamLine(line);
    expect(result).toBeNull();
  });

  it("returns null for empty content arrays", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [] },
    });

    const result = parseStreamLine(line);
    expect(result).toBeNull();
  });

  it("returns raw text for non-JSON lines", () => {
    const result = parseStreamLine("This is not JSON");
    expect(result).not.toBeNull();
    expect(result!.text).toBe("This is not JSON");
    expect(result!.isResult).toBe(false);
  });

  it("returns null for assistant messages without content", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {},
    });

    const result = parseStreamLine(line);
    expect(result).toBeNull();
  });

  it("handles tool_result with array content", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_123",
            content: [
              { type: "text", text: "Line 1" },
              { type: "text", text: "Line 2" },
            ],
          },
        ],
      },
    });

    const result = parseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("Line 1\nLine 2");
  });

  it("parses rate_limit_event with utilization", () => {
    const line = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: {
        status: "allowed_warning",
        resetsAt: 1775581200,
        rateLimitType: "seven_day",
        utilization: 0.87,
        isUsingOverage: false,
        surpassedThreshold: 0.75,
      },
    });

    const result = parseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.rateLimitUtilization).toBe(0.87);
    expect(result!.text).toBe("");
    expect(result!.isResult).toBe(false);
  });

  it("handles rate_limit_event with missing utilization", () => {
    const line = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed" },
    });

    const result = parseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.rateLimitUtilization).toBeUndefined();
  });

  it("handles rate_limit_event with no rate_limit_info", () => {
    const line = JSON.stringify({ type: "rate_limit_event" });

    const result = parseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.rateLimitUtilization).toBeUndefined();
  });
});

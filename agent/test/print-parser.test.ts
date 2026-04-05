import { describe, it, expect } from "vitest";
import { extractResultFromStreamJson, parseStreamJsonLine } from "../src/claude-code/print-parser.js";

describe("extractResultFromStreamJson", () => {
  it("returns result event text for non-preferAssistantText mode", () => {
    const lines = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } }),
      JSON.stringify({ type: "result", result: "Hello world" }),
    ];
    expect(extractResultFromStreamJson(lines, false)).toBe("Hello world");
  });

  it("uses last assistant event for preferAssistantText (handles cumulative events)", () => {
    // Cumulative CLI output: each assistant event contains full text so far
    const lines = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "He" }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Hello world" }] } }),
      JSON.stringify({ type: "result", result: "Hello world" }),
    ];
    // Should return "Hello world" (last assistant), NOT "HeHelloHello world"
    expect(extractResultFromStreamJson(lines, true)).toBe("Hello world");
  });

  it("handles single assistant event", () => {
    const lines = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "abc" }] } }),
      JSON.stringify({ type: "result", result: "abc" }),
    ];
    expect(extractResultFromStreamJson(lines, true)).toBe("abc");
  });

  it("handles multiple text blocks in last assistant event", () => {
    const lines = [
      JSON.stringify({ type: "assistant", message: { content: [
        { type: "text", text: "Part one" },
        { type: "tool_use", name: "Read" },
        { type: "text", text: " Part two" },
      ] } }),
    ];
    expect(extractResultFromStreamJson(lines, true)).toBe("Part one Part two");
  });

  it("prefers structured_output over assistant text", () => {
    const lines = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "ignored" }] } }),
      JSON.stringify({ type: "result", structured_output: { key: "value" } }),
    ];
    expect(extractResultFromStreamJson(lines, true)).toBe('{"key":"value"}');
  });

  it("returns empty string when no assistant events exist", () => {
    const lines = [
      JSON.stringify({ type: "system", message: "init" }),
    ];
    expect(extractResultFromStreamJson(lines, true)).toBe("");
  });
});

describe("parseStreamJsonLine", () => {
  it("fires onTextChunk for text blocks", () => {
    const chunks: string[] = [];
    const config = { binaryPath: "", prompt: "", onTextChunk: (t: string) => chunks.push(t) };
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } });
    parseStreamJsonLine(line, config);
    expect(chunks).toEqual(["Hello"]);
  });

  it("fires onToolUse for tool_use blocks", () => {
    const tools: string[] = [];
    const config = { binaryPath: "", prompt: "", onToolUse: (t: string) => tools.push(t) };
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } });
    parseStreamJsonLine(line, config);
    expect(tools).toEqual(["Read"]);
  });

  it("ignores non-assistant events", () => {
    const chunks: string[] = [];
    const config = { binaryPath: "", prompt: "", onTextChunk: (t: string) => chunks.push(t) };
    parseStreamJsonLine(JSON.stringify({ type: "result", result: "done" }), config);
    expect(chunks).toEqual([]);
  });
});

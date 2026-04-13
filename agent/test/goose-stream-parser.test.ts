import { describe, it, expect } from "vitest";
import { parseGooseStreamLine } from "../src/agent-backend/goose/stream-parser.js";

describe("parseGooseStreamLine", () => {
  // ── message events ─────────────────────────────────────────────────────────

  it("parses an assistant text message", () => {
    const line = JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello from Goose!" }],
      },
    });
    const result = parseGooseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("Hello from Goose!");
    expect(result!.isComplete).toBe(false);
  });

  it("parses a toolRequest message", () => {
    const line = JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolRequest",
            id: "req-1",
            toolCall: { name: "read_file", arguments: { path: "/foo.ts" } },
          },
        ],
      },
    });
    const result = parseGooseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("[Tool: read_file]");
    expect(result!.toolName).toBe("read_file");
  });

  it("parses a toolResponse Ok message", () => {
    const line = JSON.stringify({
      type: "message",
      message: {
        role: "user",
        content: [
          {
            type: "toolResponse",
            id: "req-1",
            toolResult: { Ok: "file contents here" },
          },
        ],
      },
    });
    const result = parseGooseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("file contents here");
  });

  it("parses a toolResponse Err message", () => {
    const line = JSON.stringify({
      type: "message",
      message: {
        role: "user",
        content: [
          {
            type: "toolResponse",
            id: "req-1",
            toolResult: { Err: "file not found" },
          },
        ],
      },
    });
    const result = parseGooseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("[Tool error] file not found");
  });

  it("parses mixed text and toolRequest blocks", () => {
    const line = JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check that file." },
          { type: "toolRequest", id: "req-1", toolCall: { name: "Read", arguments: {} } },
        ],
      },
    });
    const result = parseGooseStreamLine(line);
    expect(result!.text).toBe("Let me check that file.\n[Tool: Read]");
  });

  it("skips thinking blocks", () => {
    const line = JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "internal monologue..." },
          { type: "text", text: "Final answer." },
        ],
      },
    });
    const result = parseGooseStreamLine(line);
    expect(result!.text).toBe("Final answer.");
  });

  it("returns null for empty message content", () => {
    const line = JSON.stringify({
      type: "message",
      message: { role: "assistant", content: [] },
    });
    expect(parseGooseStreamLine(line)).toBeNull();
  });

  // ── complete event ─────────────────────────────────────────────────────────

  it("parses the complete event with total_tokens", () => {
    const line = JSON.stringify({ type: "complete", total_tokens: 4821 });
    const result = parseGooseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.isComplete).toBe(true);
    expect(result!.totalTokens).toBe(4821);
  });

  it("parses the complete event without total_tokens", () => {
    const line = JSON.stringify({ type: "complete", total_tokens: null });
    const result = parseGooseStreamLine(line);
    expect(result!.isComplete).toBe(true);
    expect(result!.totalTokens).toBeUndefined();
  });

  // ── error event ────────────────────────────────────────────────────────────

  it("parses an error event", () => {
    const line = JSON.stringify({ type: "error", error: "provider unavailable" });
    const result = parseGooseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("provider unavailable");
    expect(result!.isComplete).toBe(false);
  });

  // ── notification event ─────────────────────────────────────────────────────

  it("parses a notification log event", () => {
    const line = JSON.stringify({
      type: "notification",
      extension_id: "developer",
      message: "spawning shell",
    });
    const result = parseGooseStreamLine(line);
    expect(result!.text).toContain("spawning shell");
  });

  it("returns null for notification without message (e.g. progress)", () => {
    const line = JSON.stringify({ type: "notification", progress: 0.5 });
    expect(parseGooseStreamLine(line)).toBeNull();
  });

  // ── non-JSON / unknown ─────────────────────────────────────────────────────

  it("returns raw text for non-JSON lines", () => {
    const result = parseGooseStreamLine("some plain log output");
    expect(result!.text).toBe("some plain log output");
    expect(result!.isComplete).toBe(false);
  });

  it("returns null for blank lines", () => {
    expect(parseGooseStreamLine("   ")).toBeNull();
  });

  // ── tool response truncation ───────────────────────────────────────────────

  it("truncates long tool response content", () => {
    const longContent = "x".repeat(600);
    const line = JSON.stringify({
      type: "message",
      message: {
        role: "user",
        content: [{ type: "toolResponse", id: "r", toolResult: { Ok: longContent } }],
      },
    });
    const result = parseGooseStreamLine(line);
    expect(result!.text.length).toBeLessThan(600);
    expect(result!.text).toContain("(truncated)");
  });

  it("handles toolResponse with array content", () => {
    const line = JSON.stringify({
      type: "message",
      message: {
        role: "user",
        content: [
          {
            type: "toolResponse",
            id: "r",
            toolResult: {
              Ok: [
                { type: "text", text: "Line 1" },
                { type: "text", text: "Line 2" },
              ],
            },
          },
        ],
      },
    });
    const result = parseGooseStreamLine(line);
    expect(result!.text).toBe("Line 1\nLine 2");
  });
});

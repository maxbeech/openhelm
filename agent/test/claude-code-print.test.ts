import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process.spawn
const mockStdout = { on: vi.fn() };
const mockStderr = { on: vi.fn() };
const mockStdin = { write: vi.fn(), end: vi.fn() };
const mockChild = {
  stdout: mockStdout,
  stderr: mockStderr,
  stdin: mockStdin,
  on: vi.fn(),
  kill: vi.fn(),
  killed: false,
};

vi.mock("child_process", () => ({
  spawn: vi.fn(() => mockChild),
}));

vi.mock("readline", () => ({
  createInterface: vi.fn(({ input }) => {
    // Return a mock readline interface that captures line callbacks
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    return {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
        // Store on the input object so tests can emit lines
        if (input === mockStdout) {
          (mockStdout as any).__lineListeners = listeners;
        } else if (input === mockStderr) {
          (mockStderr as any).__lineListeners = listeners;
        }
      }),
    };
  }),
}));

import { spawn } from "child_process";
import { runClaudeCodePrint, PrintError } from "../src/claude-code/print.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockChild.killed = false;
  (mockStdout as any).__lineListeners = {};
  (mockStderr as any).__lineListeners = {};
});

/** Simulate the child process emitting lines and closing */
function simulateProcess(
  stdoutLines: string[],
  stderrLines: string[],
  exitCode: number | null,
) {
  // Emit stdout lines
  for (const line of stdoutLines) {
    const listeners = (mockStdout as any).__lineListeners?.line;
    if (listeners) listeners.forEach((cb: (l: string) => void) => cb(line));
  }
  // Emit stderr lines
  for (const line of stderrLines) {
    const listeners = (mockStderr as any).__lineListeners?.line;
    if (listeners) listeners.forEach((cb: (l: string) => void) => cb(line));
  }
  // Emit close
  const closeListeners = mockChild.on.mock.calls.filter(([e]) => e === "close");
  closeListeners.forEach(([, cb]) => (cb as (code: number | null) => void)(exitCode));
}

describe("runClaudeCodePrint", () => {
  it("should return text on successful execution", async () => {
    const promise = runClaudeCodePrint({
      binaryPath: "/usr/bin/claude",
      prompt: "Hello",
    });

    // Let the spawn happen
    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    simulateProcess(["Hello, world!"], [], 0);

    const result = await promise;
    expect(result.text).toBe("Hello, world!");
    expect(result.exitCode).toBe(0);
  });

  it("should pass --model flag when model is specified", async () => {
    const promise = runClaudeCodePrint({
      binaryPath: "/usr/bin/claude",
      prompt: "Test",
      model: "claude-haiku-4-5-20251001",
    });

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    const spawnArgs = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(spawnArgs).toContain("--model");
    expect(spawnArgs).toContain("claude-haiku-4-5-20251001");

    simulateProcess(["ok"], [], 0);
    await promise;
  });

  it("should pass --system-prompt flag", async () => {
    const promise = runClaudeCodePrint({
      binaryPath: "/usr/bin/claude",
      prompt: "Test",
      systemPrompt: "You are helpful.",
    });

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    const spawnArgs = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(spawnArgs).toContain("--system-prompt");
    expect(spawnArgs).toContain("You are helpful.");

    simulateProcess(["ok"], [], 0);
    await promise;
  });

  it("should pass --tools '' to disable tools by default", async () => {
    const promise = runClaudeCodePrint({
      binaryPath: "/usr/bin/claude",
      prompt: "Test",
    });

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    const spawnArgs = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(spawnArgs).toContain("--tools");
    expect(spawnArgs).toContain("");

    simulateProcess(["ok"], [], 0);
    await promise;
  });

  it("should throw PrintError on non-zero exit code", async () => {
    const promise = runClaudeCodePrint({
      binaryPath: "/usr/bin/claude",
      prompt: "Test",
    });

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    simulateProcess([], ["Error occurred"], 1);

    await expect(promise).rejects.toThrow(PrintError);
    await expect(promise).rejects.toThrow(/exited with code 1/);
  });

  it("should throw PrintError on spawn error", async () => {
    const promise = runClaudeCodePrint({
      binaryPath: "/nonexistent/claude",
      prompt: "Test",
    });

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    // Emit error event
    const errorListeners = mockChild.on.mock.calls.filter(([e]) => e === "error");
    errorListeners.forEach(([, cb]) =>
      (cb as (err: Error) => void)(new Error("ENOENT")),
    );

    await expect(promise).rejects.toThrow(PrintError);
    await expect(promise).rejects.toThrow(/Failed to spawn/);
  });

  it("should use os.tmpdir() as default working directory", async () => {
    const promise = runClaudeCodePrint({
      binaryPath: "/usr/bin/claude",
      prompt: "Test",
    });

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    const spawnOpts = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(spawnOpts.cwd).toBeDefined();
    expect(typeof spawnOpts.cwd).toBe("string");

    simulateProcess(["ok"], [], 0);
    await promise;
  });

  it("should use --output-format text by default", async () => {
    const promise = runClaudeCodePrint({
      binaryPath: "/usr/bin/claude",
      prompt: "Test",
    });

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    const spawnArgs = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(spawnArgs).toContain("--output-format");
    expect(spawnArgs[spawnArgs.indexOf("--output-format") + 1]).toBe("text");

    simulateProcess(["ok"], [], 0);
    await promise;
  });

  it("should use --output-format stream-json when jsonSchema is set", async () => {
    const schema = { type: "object", properties: { answer: { type: "string" } } };
    const promise = runClaudeCodePrint({
      binaryPath: "/usr/bin/claude",
      prompt: "Test",
      jsonSchema: schema,
    });

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    const spawnArgs = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(spawnArgs).toContain("--output-format");
    // jsonSchema calls use stream-json so we can read assistant text blocks directly
    expect(spawnArgs[spawnArgs.indexOf("--output-format") + 1]).toBe("stream-json");
    expect(spawnArgs).toContain("--json-schema");

    simulateProcess(['{"answer":"ok"}'], [], 0);
    await promise;
  });

  it("should use --output-format stream-json when onTextChunk is provided", async () => {
    const onTextChunk = vi.fn();
    const promise = runClaudeCodePrint({
      binaryPath: "/usr/bin/claude",
      prompt: "Test",
      onTextChunk,
    });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));

    const spawnArgs = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(spawnArgs[spawnArgs.indexOf("--output-format") + 1]).toBe("stream-json");

    const resultEvent = JSON.stringify({ type: "result", result: "hello" });
    simulateProcess([resultEvent], [], 0);
    const result = await promise;
    expect(result.text).toBe("hello");
  });

  it("should use --output-format stream-json when onToolUse is provided", async () => {
    const onToolUse = vi.fn();
    const promise = runClaudeCodePrint({
      binaryPath: "/usr/bin/claude",
      prompt: "Test",
      onToolUse,
    });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));

    const spawnArgs = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(spawnArgs[spawnArgs.indexOf("--output-format") + 1]).toBe("stream-json");

    const resultEvent = JSON.stringify({ type: "result", result: "done" });
    simulateProcess([resultEvent], [], 0);
    await promise;
  });

  it("should fire onTextChunk for text blocks in assistant events", async () => {
    const onTextChunk = vi.fn();
    const promise = runClaudeCodePrint({
      binaryPath: "/usr/bin/claude",
      prompt: "Test",
      onTextChunk,
    });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));

    const assistantEvent = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello world" }] },
    });
    const resultEvent = JSON.stringify({ type: "result", result: "Hello world" });
    simulateProcess([assistantEvent, resultEvent], [], 0);

    await promise;
    expect(onTextChunk).toHaveBeenCalledWith("Hello world");
  });

  it("should fire onToolUse for tool_use blocks in assistant events", async () => {
    const onToolUse = vi.fn();
    const promise = runClaudeCodePrint({
      binaryPath: "/usr/bin/claude",
      prompt: "Test",
      onToolUse,
    });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));

    const assistantEvent = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "read_file", id: "abc" }] },
    });
    const resultEvent = JSON.stringify({ type: "result", result: "" });
    simulateProcess([assistantEvent, resultEvent], [], 0);

    await promise;
    expect(onToolUse).toHaveBeenCalledWith("read_file");
  });

  it("should extract final text from result event in stream-json mode", async () => {
    const onTextChunk = vi.fn();
    const promise = runClaudeCodePrint({
      binaryPath: "/usr/bin/claude",
      prompt: "Test",
      onTextChunk,
    });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));

    const assistantEvent = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "partial" }] },
    });
    const resultEvent = JSON.stringify({ type: "result", result: "final full text" });
    simulateProcess([assistantEvent, resultEvent], [], 0);

    const result = await promise;
    // Final text comes from result event, not the partial assistant events
    expect(result.text).toBe("final full text");
  });

  it("should fall back to concatenated assistant text if no result event", async () => {
    const onTextChunk = vi.fn();
    const promise = runClaudeCodePrint({
      binaryPath: "/usr/bin/claude",
      prompt: "Test",
      onTextChunk,
    });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));

    const assistantEvent = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "fallback text" }] },
    });
    simulateProcess([assistantEvent], [], 0);

    const result = await promise;
    expect(result.text).toBe("fallback text");
  });
});

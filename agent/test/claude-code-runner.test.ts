import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { runClaudeCode, type RunnerConfig } from "../src/claude-code/runner.js";
import { setupTestDb } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STDIN_TO_STDOUT = resolve(__dirname, "fixtures/stdin-to-stdout.sh");

let cleanup: () => void;

beforeAll(() => {
  cleanup = setupTestDb();
});

afterAll(() => cleanup());

/**
 * Helper to create a runner config.
 * Note: the runner always adds --print, --output-format, etc. as args.
 * Mock binaries must tolerate or ignore these extra arguments.
 */
function mockConfig(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    binaryPath: "/bin/echo",
    workingDirectory: "/tmp",
    prompt: "test prompt",
    timeoutMs: 5000,
    onLogChunk: vi.fn(),
    ...overrides,
  };
}

describe("runClaudeCode", () => {
  it("runs a process and returns exit code 0", async () => {
    const onLogChunk = vi.fn();
    const config = mockConfig({
      binaryPath: "/bin/echo",
      prompt: "hello world",
      onLogChunk,
    });

    const result = await runClaudeCode(config);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.killed).toBe(false);
  });

  it("handles non-existent binary gracefully", async () => {
    const onLogChunk = vi.fn();
    const config = mockConfig({
      binaryPath: "/nonexistent/binary/claude",
      onLogChunk,
    });

    const result = await runClaudeCode(config);
    expect(result.exitCode).toBeNull();
    // Should have emitted an error log
    expect(onLogChunk).toHaveBeenCalled();
    const stderrCalls = onLogChunk.mock.calls.filter(
      ([stream]: [string]) => stream === "stderr",
    );
    expect(stderrCalls.length).toBeGreaterThan(0);
  });

  it("does not time out when timeoutMs is 0", async () => {
    const onLogChunk = vi.fn();
    const config = mockConfig({
      binaryPath: "/bin/echo",
      prompt: "no timeout",
      timeoutMs: 0,
      onLogChunk,
    });

    const result = await runClaudeCode(config);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it("kills process on timeout", async () => {
    // /usr/bin/yes runs forever outputting "y", ignoring extra args
    const config = mockConfig({
      binaryPath: "/usr/bin/yes",
      prompt: "y",
      timeoutMs: 300,
    });

    const result = await runClaudeCode(config);
    expect(result.timedOut).toBe(true);
    // Exit code is non-zero when killed by signal
    expect(result.exitCode).not.toBe(0);
  });

  it("kills process on abort signal", async () => {
    const controller = new AbortController();
    const config = mockConfig({
      binaryPath: "/usr/bin/yes",
      prompt: "y",
      timeoutMs: 30_000,
    });

    // Abort after 200ms
    setTimeout(() => controller.abort(), 200);

    const result = await runClaudeCode(config, controller.signal);
    expect(result.killed).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it("calls onLogChunk for stdout output", async () => {
    const onLogChunk = vi.fn();
    const config = mockConfig({
      binaryPath: "/bin/echo",
      prompt: "test output",
      onLogChunk,
    });

    await runClaudeCode(config);
    // /bin/echo outputs the args as text, parsed as non-JSON raw lines
    expect(onLogChunk).toHaveBeenCalled();
    const stdoutCalls = onLogChunk.mock.calls.filter(
      ([stream]: [string]) => stream === "stdout",
    );
    expect(stdoutCalls.length).toBeGreaterThan(0);
  });

  it("does not trigger onInteractiveDetected for pattern-like text (patterns removed)", async () => {
    const onInteractiveDetected = vi.fn();
    const onLogChunk = vi.fn();
    const config = mockConfig({
      binaryPath: STDIN_TO_STDOUT,
      prompt: "Continue? (y/n)",
      onLogChunk,
      onInteractiveDetected,
    });

    await runClaudeCode(config);
    // Pattern matching was removed — only silence timeout triggers detection
    expect(onInteractiveDetected).not.toHaveBeenCalled();
  });

  it("respects maxBudgetUsd in arguments", async () => {
    const onLogChunk = vi.fn();
    const config = mockConfig({
      binaryPath: "/bin/echo",
      prompt: "test",
      maxBudgetUsd: 1.5,
      onLogChunk,
    });

    await runClaudeCode(config);
    // echo will print all args including --max-budget-usd 1.5
    const stdoutCalls = onLogChunk.mock.calls.filter(
      ([stream]: [string]) => stream === "stdout",
    );
    const output = stdoutCalls.map(([, text]: [string, string]) => text).join(" ");
    expect(output).toContain("1.5");
  });

  it("passes --model flag when model is set", async () => {
    const onLogChunk = vi.fn();
    const config = mockConfig({
      binaryPath: "/bin/echo",
      prompt: "test",
      model: "opus",
      onLogChunk,
    });

    await runClaudeCode(config);
    const stdoutCalls = onLogChunk.mock.calls.filter(
      ([stream]: [string]) => stream === "stdout",
    );
    const output = stdoutCalls.map(([, text]: [string, string]) => text).join(" ");
    expect(output).toContain("--model");
    expect(output).toContain("opus");
  });

  it("passes --effort flag when modelEffort is set", async () => {
    const onLogChunk = vi.fn();
    const config = mockConfig({
      binaryPath: "/bin/echo",
      prompt: "test",
      modelEffort: "high",
      onLogChunk,
    });

    await runClaudeCode(config);
    const stdoutCalls = onLogChunk.mock.calls.filter(
      ([stream]: [string]) => stream === "stdout",
    );
    const output = stdoutCalls.map(([, text]: [string, string]) => text).join(" ");
    expect(output).toContain("--effort");
    expect(output).toContain("high");
  });

  it("does not pass --effort flag when modelEffort is undefined", async () => {
    const onLogChunk = vi.fn();
    const config = mockConfig({
      binaryPath: "/bin/echo",
      prompt: "test",
      onLogChunk,
    });

    await runClaudeCode(config);
    const stdoutCalls = onLogChunk.mock.calls.filter(
      ([stream]: [string]) => stream === "stdout",
    );
    const output = stdoutCalls.map(([, text]: [string, string]) => text).join(" ");
    expect(output).not.toContain("--effort");
  });

  it("passes --mcp-config flag when mcpConfigPath is set", async () => {
    const onLogChunk = vi.fn();
    const config = mockConfig({
      binaryPath: "/bin/echo",
      prompt: "test",
      mcpConfigPath: "/tmp/mcp-config.json",
      onLogChunk,
    });

    await runClaudeCode(config);
    const stdoutCalls = onLogChunk.mock.calls.filter(
      ([stream]: [string]) => stream === "stdout",
    );
    const output = stdoutCalls.map(([, text]: [string, string]) => text).join(" ");
    expect(output).toContain("--mcp-config");
    expect(output).toContain("/tmp/mcp-config.json");
  });

  it("does not pass --mcp-config flag when mcpConfigPath is undefined", async () => {
    const onLogChunk = vi.fn();
    const config = mockConfig({
      binaryPath: "/bin/echo",
      prompt: "test",
      onLogChunk,
    });

    await runClaudeCode(config);
    const stdoutCalls = onLogChunk.mock.calls.filter(
      ([stream]: [string]) => stream === "stdout",
    );
    const output = stdoutCalls.map(([, text]: [string, string]) => text).join(" ");
    expect(output).not.toContain("--mcp-config");
  });

  it("passes --append-system-prompt when appendSystemPrompt is set", async () => {
    const onLogChunk = vi.fn();
    const config = mockConfig({
      binaryPath: "/bin/echo",
      prompt: "test",
      appendSystemPrompt: "Use openhelm_browser for all browser tasks.",
      onLogChunk,
    });

    await runClaudeCode(config);
    const stdoutCalls = onLogChunk.mock.calls.filter(
      ([stream]: [string]) => stream === "stdout",
    );
    const output = stdoutCalls.map(([, text]: [string, string]) => text).join(" ");
    expect(output).toContain("--append-system-prompt");
    expect(output).toContain("Use openhelm_browser for all browser tasks.");
  });
});

describe("runClaudeCode integration", () => {
  /**
   * Integration test: runs against the real Claude Code binary.
   * Skipped in regular test runs — requires real Claude Code and API credentials.
   * Run manually with: npx vitest run test/claude-code-runner.test.ts
   */
  it.skip("runs a real Claude Code job", async () => {
    const logs: Array<{ stream: string; text: string }> = [];
    const config: RunnerConfig = {
      binaryPath: "claude",
      workingDirectory: "/tmp",
      prompt: "What is 2 + 2? Reply with just the number.",
      timeoutMs: 60_000,
      onLogChunk: (stream, text) => {
        logs.push({ stream, text });
      },
    };

    const result = await runClaudeCode(config);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(logs.length).toBeGreaterThan(0);

    const allText = logs
      .filter((l) => l.stream === "stdout")
      .map((l) => l.text)
      .join(" ");
    expect(allText).toContain("4");
  });
});

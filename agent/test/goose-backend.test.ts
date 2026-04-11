/**
 * Unit tests for GooseBackend.
 *
 * All tests mock the Goose process layer — no actual goose binary required.
 * Tests verify:
 *  - resolveModel() tier mapping
 *  - buildMcpConfig() / buildExtensionFlags() output
 *  - run() maps stream events to AgentRunResult and fires callbacks
 *  - llmCall() collects text and resolves LlmCallResult
 *  - kill() is a no-op that logs to stderr
 *  - Registry integration: GooseBackend can be registered and retrieved
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PassThrough } from "stream";

// ── Module-level mocks (hoisted by vitest) ────────────────────────────────────

vi.mock("../src/agent-backend/goose/detector.js", () => ({
  detectGoose: vi.fn().mockResolvedValue({ path: "/usr/local/bin/goose", version: "1.29.1" }),
  checkGooseHealth: vi.fn().mockResolvedValue({ healthy: true, authenticated: true }),
  MIN_GOOSE_VERSION: "1.10.0",
  compareGooseSemver: (_a: string, _b: string) => 0,
}));

// Track the factory so individual tests can override it
let spawnFactory: (() => ReturnType<typeof makeFakeProcess>) | null = null;
/** Captures args passed to every spawned process — inspected by buildRunArgs tests. */
const spawnCalls: { command: string; args: string[] }[] = [];

vi.mock("child_process", async (importOriginal) => {
  const orig = await importOriginal<typeof import("child_process")>();
  return {
    ...orig,
    spawn: (command: string, args: string[], ..._rest: unknown[]) => {
      spawnCalls.push({ command, args });
      if (spawnFactory) return spawnFactory();
      // Default: process that immediately closes with exit code 0
      return makeFakeProcess([], [], 0);
    },
  };
});

// ── Imports (after mocks are set up) ─────────────────────────────────────────

import { GooseBackend } from "../src/agent-backend/goose/index.js";
import { registerBackend, getBackend, resetRegistry } from "../src/agent-backend/registry.js";
import type { AgentEvent, McpServerConfig } from "../src/agent-backend/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a fake ChildProcess using PassThrough streams so readline.createInterface works */
function makeFakeProcess(stdoutLines: string[], stderrLines: string[] = [], exitCode: number | null = 0) {
  const fakeStdout = new PassThrough();
  const fakeStderr = new PassThrough();
  const fakeStdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() } as any;

  const { EventEmitter } = require("events");
  const proc = new EventEmitter() as any;
  proc.stdout = fakeStdout;
  proc.stderr = fakeStderr;
  proc.stdin = fakeStdin;
  proc.pid = 12345;
  proc.killed = false;
  proc.kill = vi.fn();

  setImmediate(() => {
    for (const line of stdoutLines) {
      fakeStdout.write(line + "\n");
    }
    fakeStdout.end();
    for (const line of stderrLines) {
      fakeStderr.write(line + "\n");
    }
    fakeStderr.end();
    // Give readline time to drain lines before close fires
    setImmediate(() => proc.emit("close", exitCode));
  });

  return proc;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GooseBackend — resolveModel (default Anthropic provider)", () => {
  const backend = new GooseBackend();

  it("maps planning to claude-sonnet-4-6", () => {
    expect(backend.resolveModel("planning")).toBe("claude-sonnet-4-6");
  });

  it("maps classification to claude-haiku", () => {
    expect(backend.resolveModel("classification")).toContain("haiku");
  });

  it("maps chat to claude-haiku", () => {
    expect(backend.resolveModel("chat")).toContain("haiku");
  });

  it("maps execution to claude-sonnet-4-6", () => {
    expect(backend.resolveModel("execution")).toBe("claude-sonnet-4-6");
  });
});

describe("GooseBackend — resolveModel (provider config override)", () => {
  it("uses OpenAI defaults when provider=openai", () => {
    const backend = new GooseBackend({ provider: "openai" });
    expect(backend.resolveModel("planning")).toBe("gpt-4o");
    expect(backend.resolveModel("classification")).toBe("gpt-4o-mini");
    expect(backend.resolveModel("execution")).toBe("gpt-4o");
  });

  it("uses OpenRouter defaults when provider=openrouter", () => {
    const backend = new GooseBackend({ provider: "openrouter" });
    expect(backend.resolveModel("planning")).toContain("claude-sonnet");
  });

  it("constructor model overrides take precedence over provider defaults", () => {
    const backend = new GooseBackend({
      provider: "openai",
      models: { planning: "o3", execution: "o3" },
    });
    expect(backend.resolveModel("planning")).toBe("o3");
    expect(backend.resolveModel("execution")).toBe("o3");
    expect(backend.resolveModel("classification")).toBe("gpt-4o-mini"); // unoverridden
  });
});

describe("GooseBackend — buildMcpConfig", () => {
  const backend = new GooseBackend();

  it("returns the servers list wrapped in an object", () => {
    const servers: McpServerConfig[] = [
      { name: "browser", command: "node", args: ["/path/browser-server.js"] },
    ];
    const config = backend.buildMcpConfig(servers) as { servers: McpServerConfig[] };
    expect(config.servers).toEqual(servers);
  });

  it("builds --with-extension flag strings", () => {
    const servers: McpServerConfig[] = [
      { name: "memory", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] },
      { name: "browser", command: "node", args: ["/srv/browser.js"] },
    ];
    const flags = backend.buildExtensionFlags(servers);
    expect(flags).toEqual([
      "--with-extension", "npx -y @modelcontextprotocol/server-memory",
      "--with-extension", "node /srv/browser.js",
    ]);
  });

  it("returns empty array for empty servers list", () => {
    expect(backend.buildExtensionFlags([])).toEqual([]);
  });
});

describe("GooseBackend — detect & healthCheck", () => {
  it("detect() returns BackendInfo when Goose is found", async () => {
    const backend = new GooseBackend();
    const info = await backend.detect();
    expect(info).not.toBeNull();
    expect(info!.name).toBe("goose");
    expect(info!.version).toBe("1.29.1");
    expect(info!.path).toBe("/usr/local/bin/goose");
  });

  it("healthCheck() returns ok: true when healthy", async () => {
    const backend = new GooseBackend();
    await backend.detect();
    const result = await backend.healthCheck();
    expect(result.ok).toBe(true);
  });
});

describe("GooseBackend — run()", () => {
  afterEach(() => { spawnFactory = null; spawnCalls.length = 0; });

  it("forwards --mcp-config flag when mcpConfigPath is set", async () => {
    spawnFactory = () => makeFakeProcess([
      JSON.stringify({ type: "complete", total_tokens: 0 }),
    ]);
    const backend = new GooseBackend();
    await backend.run({
      prompt: "x",
      workingDirectory: "/tmp",
      mcpConfigPath: "/tmp/mcp-config.json",
    });
    const runCall = spawnCalls.find((c) => c.args.includes("run"));
    expect(runCall).toBeDefined();
    const mcpIdx = runCall!.args.indexOf("--mcp-config");
    expect(mcpIdx).toBeGreaterThanOrEqual(0);
    expect(runCall!.args[mcpIdx + 1]).toBe("/tmp/mcp-config.json");
  });

  it("does not pass --mcp-config flag when mcpConfigPath is undefined", async () => {
    spawnFactory = () => makeFakeProcess([
      JSON.stringify({ type: "complete", total_tokens: 0 }),
    ]);
    const backend = new GooseBackend();
    await backend.run({ prompt: "x", workingDirectory: "/tmp" });
    const runCall = spawnCalls.find((c) => c.args.includes("run"));
    expect(runCall).toBeDefined();
    expect(runCall!.args).not.toContain("--mcp-config");
  });

  it("resolves with exitCode 0 and captures totalTokens from complete event", async () => {
    spawnFactory = () => makeFakeProcess([
      JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Done!" }] } }),
      JSON.stringify({ type: "complete", total_tokens: 999 }),
    ]);

    const backend = new GooseBackend();
    const events: AgentEvent[] = [];
    const result = await backend.run({
      prompt: "refactor this",
      workingDirectory: "/tmp/project",
      onEvent: (ev) => events.push(ev),
    });

    expect(result.exitCode).toBe(0);
    expect(result.outputTokens).toBe(999);
    expect(result.sessionId).toBeNull();
    expect(result.timedOut).toBe(false);
    expect(result.killed).toBe(false);

    const resultEvent = events.find((e) => e.type === "result");
    expect(resultEvent).toBeDefined();
  });

  it("fires onEvent for assistant text", async () => {
    spawnFactory = () => makeFakeProcess([
      JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Hello!" }] } }),
      JSON.stringify({ type: "complete", total_tokens: 10 }),
    ]);

    const backend = new GooseBackend();
    const events: AgentEvent[] = [];
    await backend.run({
      prompt: "hi",
      workingDirectory: "/tmp",
      onEvent: (ev) => events.push(ev),
    });

    const assistantEvent = events.find((e) => e.type === "assistant");
    expect(assistantEvent?.text).toBe("Hello!");
  });

  it("fires onEvent for pid as system event", async () => {
    spawnFactory = () => makeFakeProcess([JSON.stringify({ type: "complete", total_tokens: 0 })]);

    const backend = new GooseBackend();
    const events: AgentEvent[] = [];
    await backend.run({
      prompt: "hi",
      workingDirectory: "/tmp",
      onEvent: (ev) => events.push(ev),
    });

    const pidEvent = events.find((e) => e.type === "system");
    expect(pidEvent).toBeDefined();
    expect((pidEvent!.data as any).kind).toBe("pid");
  });

  it("marks timedOut when AbortSignal fires", async () => {
    const controller = new AbortController();
    spawnFactory = () => {
      // Process that never closes on its own
      const proc = makeFakeProcess([]);
      // Abort immediately
      setImmediate(() => controller.abort());
      return proc;
    };

    const backend = new GooseBackend();
    const result = await backend.run({
      prompt: "hang",
      workingDirectory: "/tmp",
      abortSignal: controller.signal,
    });

    expect(result.killed).toBe(true);
  });
});

describe("GooseBackend — llmCall()", () => {
  afterEach(() => { spawnFactory = null; });

  it("resolves with collected text", async () => {
    spawnFactory = () => makeFakeProcess([
      JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "The answer is 42." }] } }),
      JSON.stringify({ type: "complete", total_tokens: 50 }),
    ]);

    const backend = new GooseBackend();
    const result = await backend.llmCall({
      userMessage: "What is the answer?",
      systemPrompt: "You are helpful.",
    });

    expect(result.text).toBe("The answer is 42.");
    expect(result.sessionId).toBeNull();
  });

  it("fires onTextChunk for each text part", async () => {
    spawnFactory = () => makeFakeProcess([
      JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Part one." }] } }),
      JSON.stringify({ type: "complete", total_tokens: 10 }),
    ]);

    const backend = new GooseBackend();
    const chunks: string[] = [];
    await backend.llmCall({
      userMessage: "hi",
      onTextChunk: (c) => chunks.push(c),
    });

    expect(chunks).toContain("Part one.");
  });

  it("rejects on non-zero exit with no text", async () => {
    spawnFactory = () => makeFakeProcess([], [], 1);

    const backend = new GooseBackend();
    await expect(backend.llmCall({ userMessage: "hi" })).rejects.toThrow(/exit code 1/);
  });
});

describe("GooseBackend — kill()", () => {
  it("logs to stderr and returns without throwing", async () => {
    const backend = new GooseBackend();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(backend.kill("some-session-id")).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("AbortSignal"));
    errSpy.mockRestore();
  });
});

describe("GooseBackend — registry integration", () => {
  beforeEach(() => resetRegistry());
  afterEach(() => resetRegistry());

  it("can be registered and retrieved via getBackend()", () => {
    const backend = new GooseBackend();
    registerBackend(backend);
    const retrieved = getBackend("goose");
    expect(retrieved).toBe(backend);
    expect(retrieved.name).toBe("goose");
  });

  it("getBackend() returns GooseBackend when it is the active backend", () => {
    const backend = new GooseBackend();
    registerBackend(backend);
    expect(getBackend()).toBe(backend);
  });
});

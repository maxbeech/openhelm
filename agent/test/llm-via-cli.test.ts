import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { setupTestDb } from "./helpers.js";
import { setSetting } from "../src/db/queries/settings.js";

const runClaudeCodePrintMock = vi.fn();

vi.mock("../src/claude-code/print.js", () => ({
  runClaudeCodePrint: (...args: unknown[]) => runClaudeCodePrintMock(...args),
  PrintError: class PrintError extends Error {},
}));

import { callLlmViaCli } from "../src/planner/llm-via-cli.js";

let cleanup: () => void;

beforeAll(() => {
  cleanup = setupTestDb();
  setSetting("claude_code_path", "/usr/bin/claude");
});

afterAll(() => {
  cleanup();
});

describe("callLlmViaCli — disableTools passthrough", () => {
  it("defaults disableTools to true when not set", async () => {
    runClaudeCodePrintMock.mockResolvedValueOnce({ text: "ok", exitCode: 0 });

    await callLlmViaCli({ systemPrompt: "sys", userMessage: "hi" });

    expect(runClaudeCodePrintMock).toHaveBeenCalledWith(
      expect.objectContaining({ disableTools: true }),
    );
  });

  it("passes disableTools: false when explicitly set", async () => {
    runClaudeCodePrintMock.mockResolvedValueOnce({ text: "ok", exitCode: 0 });

    await callLlmViaCli({ systemPrompt: "sys", userMessage: "hi", disableTools: false });

    expect(runClaudeCodePrintMock).toHaveBeenCalledWith(
      expect.objectContaining({ disableTools: false }),
    );
  });

  it("passes disableTools: true when explicitly set to true", async () => {
    runClaudeCodePrintMock.mockResolvedValueOnce({ text: "ok", exitCode: 0 });

    await callLlmViaCli({ systemPrompt: "sys", userMessage: "hi", disableTools: true });

    expect(runClaudeCodePrintMock).toHaveBeenCalledWith(
      expect.objectContaining({ disableTools: true }),
    );
  });
});

describe("callLlmViaCli — workingDirectory passthrough", () => {
  it("passes workingDirectory when set", async () => {
    runClaudeCodePrintMock.mockResolvedValueOnce({ text: "ok", exitCode: 0 });

    await callLlmViaCli({
      systemPrompt: "sys",
      userMessage: "hi",
      workingDirectory: "/my/project",
    });

    expect(runClaudeCodePrintMock).toHaveBeenCalledWith(
      expect.objectContaining({ workingDirectory: "/my/project" }),
    );
  });

  it("passes workingDirectory as undefined when not set", async () => {
    runClaudeCodePrintMock.mockResolvedValueOnce({ text: "ok", exitCode: 0 });

    await callLlmViaCli({ systemPrompt: "sys", userMessage: "hi" });

    expect(runClaudeCodePrintMock).toHaveBeenCalledWith(
      expect.objectContaining({ workingDirectory: undefined }),
    );
  });
});

describe("callLlmViaCli — existing callers unaffected", () => {
  it("planning tier still defaults to disableTools: true", async () => {
    runClaudeCodePrintMock.mockResolvedValueOnce({ text: "plan", exitCode: 0 });

    await callLlmViaCli({ model: "planning", systemPrompt: "s", userMessage: "plan this" });

    expect(runClaudeCodePrintMock).toHaveBeenCalledWith(
      expect.objectContaining({ disableTools: true }),
    );
  });

  it("classification tier still defaults to disableTools: true", async () => {
    runClaudeCodePrintMock.mockResolvedValueOnce({ text: "yes", exitCode: 0 });

    await callLlmViaCli({ model: "classification", systemPrompt: "s", userMessage: "classify" });

    expect(runClaudeCodePrintMock).toHaveBeenCalledWith(
      expect.objectContaining({ disableTools: true }),
    );
  });
});

describe("callLlmViaCli — permissionMode passthrough", () => {
  it("passes permissionMode when set", async () => {
    runClaudeCodePrintMock.mockResolvedValueOnce({ text: "ok", exitCode: 0 });

    await callLlmViaCli({
      systemPrompt: "sys",
      userMessage: "hi",
      permissionMode: "plan",
    });

    expect(runClaudeCodePrintMock).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: "plan" }),
    );
  });

  it("passes permissionMode as undefined when not set", async () => {
    runClaudeCodePrintMock.mockResolvedValueOnce({ text: "ok", exitCode: 0 });

    await callLlmViaCli({ systemPrompt: "sys", userMessage: "hi" });

    expect(runClaudeCodePrintMock).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: undefined }),
    );
  });
});

describe("callLlmViaCli — chat tier timeout", () => {
  it("uses 300s timeout for chat tier", async () => {
    runClaudeCodePrintMock.mockResolvedValueOnce({ text: "hi", exitCode: 0 });

    await callLlmViaCli({ model: "chat", systemPrompt: "s", userMessage: "hello" });

    expect(runClaudeCodePrintMock).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 300_000 }),
    );
  });
});

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { setupTestDb } from "./helpers.js";

// Mock the backend registry so callLlmViaCli routes through a controllable mock
const llmCallMock = vi.fn();
const resolveModelMock = vi.fn((tier: string) => {
  const map: Record<string, string> = {
    planning: "sonnet",
    classification: "claude-haiku-4-5-20251001",
    chat: "claude-haiku-4-5-20251001",
    execution: "sonnet",
  };
  return map[tier] ?? "sonnet";
});

vi.mock("../src/agent-backend/registry.js", () => ({
  getBackend: () => ({
    name: "mock",
    llmCall: (...args: unknown[]) => llmCallMock(...args),
    resolveModel: (tier: string) => resolveModelMock(tier),
  }),
}));

import { callLlmViaCli } from "../src/planner/llm-via-cli.js";

let cleanup: () => void;

beforeAll(() => {
  cleanup = setupTestDb();
});

afterAll(() => {
  cleanup();
});

describe("callLlmViaCli — disableTools passthrough", () => {
  it("defaults disableTools to true when not set", async () => {
    llmCallMock.mockResolvedValueOnce({ text: "ok", sessionId: null });

    await callLlmViaCli({ systemPrompt: "sys", userMessage: "hi" });

    expect(llmCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ disableTools: true }),
    );
  });

  it("passes disableTools: false when explicitly set", async () => {
    llmCallMock.mockResolvedValueOnce({ text: "ok", sessionId: null });

    await callLlmViaCli({ systemPrompt: "sys", userMessage: "hi", disableTools: false });

    expect(llmCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ disableTools: false }),
    );
  });

  it("passes disableTools: true when explicitly set to true", async () => {
    llmCallMock.mockResolvedValueOnce({ text: "ok", sessionId: null });

    await callLlmViaCli({ systemPrompt: "sys", userMessage: "hi", disableTools: true });

    expect(llmCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ disableTools: true }),
    );
  });
});

describe("callLlmViaCli — workingDirectory passthrough", () => {
  it("passes workingDirectory when set", async () => {
    llmCallMock.mockResolvedValueOnce({ text: "ok", sessionId: null });

    await callLlmViaCli({
      systemPrompt: "sys",
      userMessage: "hi",
      workingDirectory: "/my/project",
    });

    expect(llmCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ workingDirectory: "/my/project" }),
    );
  });

  it("passes workingDirectory as undefined when not set", async () => {
    llmCallMock.mockResolvedValueOnce({ text: "ok", sessionId: null });

    await callLlmViaCli({ systemPrompt: "sys", userMessage: "hi" });

    expect(llmCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ workingDirectory: undefined }),
    );
  });
});

describe("callLlmViaCli — existing callers unaffected", () => {
  it("planning tier still defaults to disableTools: true", async () => {
    llmCallMock.mockResolvedValueOnce({ text: "plan", sessionId: null });

    await callLlmViaCli({ model: "planning", systemPrompt: "s", userMessage: "plan this" });

    expect(llmCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ disableTools: true }),
    );
  });

  it("classification tier still defaults to disableTools: true", async () => {
    llmCallMock.mockResolvedValueOnce({ text: "yes", sessionId: null });

    await callLlmViaCli({ model: "classification", systemPrompt: "s", userMessage: "classify" });

    expect(llmCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ disableTools: true }),
    );
  });
});

describe("callLlmViaCli — permissionMode passthrough", () => {
  it("passes permissionMode when set", async () => {
    llmCallMock.mockResolvedValueOnce({ text: "ok", sessionId: null });

    await callLlmViaCli({
      systemPrompt: "sys",
      userMessage: "hi",
      permissionMode: "plan",
    });

    expect(llmCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: "plan" }),
    );
  });

  it("passes permissionMode as undefined when not set", async () => {
    llmCallMock.mockResolvedValueOnce({ text: "ok", sessionId: null });

    await callLlmViaCli({ systemPrompt: "sys", userMessage: "hi" });

    expect(llmCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: undefined }),
    );
  });
});

describe("callLlmViaCli — chat tier timeout", () => {
  it("uses 600s timeout for chat tier", async () => {
    llmCallMock.mockResolvedValueOnce({ text: "hi", sessionId: null });

    await callLlmViaCli({ model: "chat", systemPrompt: "s", userMessage: "hello" });

    expect(llmCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 600_000 }),
    );
  });
});

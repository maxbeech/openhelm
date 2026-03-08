import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb } from "./helpers.js";
import { registerHandler, handleRequest } from "../src/ipc/handler.js";
import { LlmError } from "../src/llm/client.js";

let cleanup: () => void;

beforeAll(() => {
  cleanup = setupTestDb();

  // Register test handlers that throw specific error types
  registerHandler("test.throwLlmMissingKey", () => {
    throw new LlmError("API key not set", "missing_api_key");
  });

  registerHandler("test.throwLlmNetwork", () => {
    throw new LlmError("Connection refused", "network_error");
  });

  registerHandler("test.throwLlmRateLimited", () => {
    throw new LlmError("Rate limited", "rate_limited");
  });

  registerHandler("test.throwGenericError", () => {
    throw new Error("Something broke");
  });

  registerHandler("test.throwString", () => {
    throw "raw string error"; // eslint-disable-line no-throw-literal
  });

  registerHandler("test.success", () => ({ ok: true }));
});

afterAll(() => cleanup());

describe("IPC handler — LlmError mapping", () => {
  it("maps missing_api_key to code -32001 with friendly message", async () => {
    const res = await handleRequest({
      id: "1",
      method: "test.throwLlmMissingKey",
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32001);
    expect(res.error!.message).toContain("API key not configured");
    expect(res.error!.message).toContain("Settings");
  });

  it("maps network_error to code -32001 with friendly message", async () => {
    const res = await handleRequest({
      id: "2",
      method: "test.throwLlmNetwork",
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32001);
    expect(res.error!.message).toContain("internet connection");
  });

  it("maps rate_limited to code -32001 with friendly message", async () => {
    const res = await handleRequest({
      id: "3",
      method: "test.throwLlmRateLimited",
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32001);
    expect(res.error!.message).toContain("rate limit");
  });
});

describe("IPC handler — generic errors", () => {
  it("maps a regular Error to code -32603", async () => {
    const res = await handleRequest({
      id: "4",
      method: "test.throwGenericError",
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32603);
    expect(res.error!.message).toBe("Something broke");
  });

  it("maps a thrown string to code -32603", async () => {
    const res = await handleRequest({
      id: "5",
      method: "test.throwString",
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32603);
    expect(res.error!.message).toBe("raw string error");
  });
});

describe("IPC handler — unknown method", () => {
  it("returns code -32601 for unknown methods", async () => {
    const res = await handleRequest({
      id: "6",
      method: "nonexistent.method",
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32601);
    expect(res.error!.message).toContain("Unknown method");
  });
});

describe("IPC handler — success path", () => {
  it("returns result with no error on success", async () => {
    const res = await handleRequest({ id: "7", method: "test.success" });
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({ ok: true });
    expect(res.id).toBe("7");
  });
});

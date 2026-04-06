import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupTestDb } from "./helpers.js";
import {
  isTransientCliError,
  recordTransientError,
  resetTransientErrorCount,
  handleTransientCliError,
} from "../src/executor/cli-error-monitor.js";
import { setSetting, getSetting, deleteSetting } from "../src/db/queries/settings.js";

let cleanup: () => void;

// Mock the emitter
vi.mock("../src/ipc/emitter.js", () => ({
  emit: vi.fn(),
  send: vi.fn(),
}));

// Mock the scheduler
vi.mock("../src/scheduler/index.js", () => ({
  scheduler: { stop: vi.fn(), start: vi.fn() },
}));

// Mock auth-monitor's getOrCreateSystemHealthJob
vi.mock("../src/executor/auth-monitor.js", () => ({
  getOrCreateSystemHealthJob: vi.fn(() => ({ id: "sentinel-job-id" })),
}));

// Mock dashboard items (needed by handleTransientCliError)
vi.mock("../src/db/queries/dashboard-items.js", () => ({
  createDashboardItem: vi.fn((data: Record<string, unknown>) => ({
    id: "mock-item-id",
    ...data,
  })),
}));

describe("isTransientCliError", () => {
  beforeEach(() => {
    cleanup = setupTestDb();
  });

  it("matches 'An unknown error occurred (Unexpected)'", () => {
    expect(isTransientCliError("error: An unknown error occurred (Unexpected)")).toBe(true);
  });

  it("matches 'Overloaded' error", () => {
    expect(isTransientCliError("error: Overloaded")).toBe(true);
  });

  it("matches 'API Error' case-insensitively", () => {
    expect(isTransientCliError("error: api error")).toBe(true);
  });

  it("matches rate limit errors", () => {
    expect(isTransientCliError("error: Rate limit exceeded")).toBe(true);
    expect(isTransientCliError("error: Too many requests")).toBe(true);
  });

  it("does NOT match long stderr (real task output)", () => {
    const longStderr = "error: An unknown error occurred (Unexpected)\n" + "x".repeat(500);
    expect(isTransientCliError(longStderr)).toBe(false);
  });

  it("does NOT match unrelated errors", () => {
    expect(isTransientCliError("Permission denied")).toBe(false);
    expect(isTransientCliError("File not found")).toBe(false);
  });

  afterEach(() => {
    cleanup?.();
  });
});

describe("recordTransientError / resetTransientErrorCount", () => {
  beforeEach(() => {
    cleanup = setupTestDb();
    resetTransientErrorCount();
  });

  it("increments the counter", () => {
    expect(recordTransientError()).toEqual({ shouldPause: false, count: 1 });
    expect(recordTransientError()).toEqual({ shouldPause: false, count: 2 });
    expect(recordTransientError()).toEqual({ shouldPause: false, count: 3 });
  });

  it("trips the circuit breaker at threshold", () => {
    for (let i = 0; i < 4; i++) recordTransientError();
    const result = recordTransientError();
    expect(result).toEqual({ shouldPause: true, count: 5 });
  });

  it("resets counter", () => {
    recordTransientError();
    recordTransientError();
    resetTransientErrorCount();
    expect(recordTransientError()).toEqual({ shouldPause: false, count: 1 });
  });

  afterEach(() => {
    cleanup?.();
  });
});

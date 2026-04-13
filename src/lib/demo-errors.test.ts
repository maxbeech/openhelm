import { describe, it, expect } from "vitest";
import {
  DemoReadOnlyError,
  DemoRateLimitError,
  DEMO_RATE_LIMIT_ERROR_CODE,
  isDemoReadOnlyError,
  isDemoRateLimitError,
} from "./demo-errors";

describe("DemoReadOnlyError", () => {
  it("captures the attempted method name", () => {
    const err = new DemoReadOnlyError("jobs.create");
    expect(err.method).toBe("jobs.create");
    expect(err.isDemoReadOnly).toBe(true);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DemoReadOnlyError);
  });

  it("message mentions the method and demo mode", () => {
    const err = new DemoReadOnlyError("data_tables.insert");
    expect(err.message).toMatch(/demo mode is read-only/i);
    expect(err.message).toContain("data_tables.insert");
  });

  it("isDemoReadOnlyError type guard works", () => {
    expect(isDemoReadOnlyError(new DemoReadOnlyError("x"))).toBe(true);
    expect(isDemoReadOnlyError(new Error("generic"))).toBe(false);
    expect(isDemoReadOnlyError(null)).toBe(false);
    expect(isDemoReadOnlyError("string")).toBe(false);
    // Works across realm-ish boundaries via duck-typing
    expect(isDemoReadOnlyError({ isDemoReadOnly: true })).toBe(true);
  });
});

describe("DemoRateLimitError", () => {
  it("captures the reason code", () => {
    const err = new DemoRateLimitError("session_cap_reached");
    expect(err.reason).toBe("session_cap_reached");
    expect(err.isDemoRateLimit).toBe(true);
  });

  it("isDemoRateLimitError type guard works", () => {
    expect(isDemoRateLimitError(new DemoRateLimitError("x"))).toBe(true);
    expect(isDemoRateLimitError(new DemoReadOnlyError("x"))).toBe(false);
    expect(isDemoRateLimitError(undefined)).toBe(false);
  });
});

describe("error code constants", () => {
  it("rate limit code matches the worker contract", () => {
    expect(DEMO_RATE_LIMIT_ERROR_CODE).toBe(4290);
  });
});

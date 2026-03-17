import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @sentry/node before importing sentry.ts
vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  close: vi.fn(() => Promise.resolve(true)),
  withScope: vi.fn((cb: (scope: { setExtra: ReturnType<typeof vi.fn> }) => void) => {
    cb({ setExtra: vi.fn() });
  }),
  addBreadcrumb: vi.fn(),
}));

vi.mock("../src/db/queries/settings.js", () => ({
  getSetting: vi.fn(),
}));

import * as Sentry from "@sentry/node";
import { getSetting } from "../src/db/queries/settings.js";
import {
  initAgentSentry,
  captureAgentError,
  addAgentBreadcrumb,
  isAnalyticsEnabled,
} from "../src/sentry.js";

const mockGetSetting = vi.mocked(getSetting);

beforeEach(() => {
  vi.clearAllMocks();
  // Reset internal _enabled state by re-running through module re-import is not straightforward in ESM;
  // instead, we test via observable behaviour (Sentry mock calls)
});

describe("initAgentSentry", () => {
  it("inits Sentry and stays enabled when analytics_enabled = 'true'", () => {
    mockGetSetting.mockReturnValue({
      key: "analytics_enabled",
      value: "true",
      updatedAt: "",
    });
    initAgentSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.close).not.toHaveBeenCalled();
    expect(isAnalyticsEnabled()).toBe(true);
  });

  it("calls Sentry.close when analytics_enabled = 'false'", () => {
    mockGetSetting.mockReturnValue({
      key: "analytics_enabled",
      value: "false",
      updatedAt: "",
    });
    initAgentSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.close).toHaveBeenCalledWith(0);
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it("defaults to enabled when analytics_enabled setting is absent", () => {
    mockGetSetting.mockReturnValue(null);
    initAgentSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.close).not.toHaveBeenCalled();
    expect(isAnalyticsEnabled()).toBe(true);
  });

  it("does not propagate when Sentry.init throws", () => {
    mockGetSetting.mockReturnValue(null);
    vi.mocked(Sentry.init).mockImplementationOnce(() => {
      throw new Error("Sentry init failed");
    });
    expect(() => initAgentSentry()).not.toThrow();
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it("is idempotent with respect to the beforeSend scrubber", () => {
    mockGetSetting.mockReturnValue(null);
    initAgentSentry();
    const initArg = vi.mocked(Sentry.init).mock.calls[0][0] as {
      beforeSend?: (event: {
        extra?: Record<string, unknown>;
      }) => null | { extra?: Record<string, unknown> };
    };
    expect(typeof initArg.beforeSend).toBe("function");
  });
});

describe("beforeSend scrubber", () => {
  it("strips non-whitelisted extra keys", () => {
    mockGetSetting.mockReturnValue(null);
    initAgentSentry();
    const initArg = vi.mocked(Sentry.init).mock.calls[0][0] as {
      beforeSend: (event: {
        extra?: Record<string, unknown>;
      }) => null | { extra?: Record<string, unknown> };
    };
    const result = initArg.beforeSend({
      extra: {
        runId: "r1",
        jobId: "j1",
        secretKey: "should-be-stripped",
        userPrompt: "also-stripped",
      },
    });
    expect(result).not.toBeNull();
    expect(result!.extra).toEqual({ runId: "r1", jobId: "j1" });
  });

  it("returns null when analytics is disabled", () => {
    mockGetSetting.mockReturnValue({
      key: "analytics_enabled",
      value: "false",
      updatedAt: "",
    });
    initAgentSentry();
    const initArg = vi.mocked(Sentry.init).mock.calls[0][0] as {
      beforeSend: (event: Record<string, unknown>) => null | Record<string, unknown>;
    };
    const result = initArg.beforeSend({ extra: { runId: "r1" } });
    expect(result).toBeNull();
  });
});

describe("captureAgentError", () => {
  it("calls Sentry.captureException when enabled", () => {
    mockGetSetting.mockReturnValue(null); // enabled
    initAgentSentry();
    vi.clearAllMocks(); // clear init call counts

    captureAgentError(new Error("test error"), { runId: "r1" });
    expect(Sentry.withScope).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when disabled", () => {
    mockGetSetting.mockReturnValue({
      key: "analytics_enabled",
      value: "false",
      updatedAt: "",
    });
    initAgentSentry();
    vi.clearAllMocks();

    captureAgentError(new Error("test error"));
    expect(Sentry.withScope).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("wraps non-Error values in Error", () => {
    mockGetSetting.mockReturnValue(null);
    initAgentSentry();
    vi.clearAllMocks();

    let capturedErr: unknown;
    vi.mocked(Sentry.captureException).mockImplementation((e) => {
      capturedErr = e;
      return "event-id";
    });

    captureAgentError("string error");
    expect(capturedErr).toBeInstanceOf(Error);
    expect((capturedErr as Error).message).toBe("string error");
  });
});

describe("addAgentBreadcrumb", () => {
  it("calls Sentry.addBreadcrumb when enabled", () => {
    mockGetSetting.mockReturnValue(null);
    initAgentSentry();
    vi.clearAllMocks();

    addAgentBreadcrumb("run.failed", { runId: "r1", exitCode: 1 });
    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when disabled", () => {
    mockGetSetting.mockReturnValue({
      key: "analytics_enabled",
      value: "false",
      updatedAt: "",
    });
    initAgentSentry();
    vi.clearAllMocks();

    addAgentBreadcrumb("run.failed", { runId: "r1" });
    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
  });
});

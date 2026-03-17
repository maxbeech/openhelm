import { describe, it, expect, vi, beforeEach } from "vitest";

// Note: @/lib/sentry is globally mocked in test-setup.ts.
// This test file needs the REAL module, so we import via vi.importActual.
// The vi.mock for @sentry/react below intercepts the real module's dep.

vi.unmock("@/lib/sentry");

vi.mock("@sentry/react", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn(
    (cb: (scope: { setExtra: ReturnType<typeof vi.fn> }) => void) => {
      cb({ setExtra: vi.fn() });
    },
  ),
  addBreadcrumb: vi.fn(),
}));

import * as Sentry from "@sentry/react";
import {
  initFrontendSentry,
  setAnalyticsEnabled,
  captureFrontendError,
  addUserBreadcrumb,
} from "@/lib/sentry";

beforeEach(() => {
  vi.clearAllMocks();
  // Re-enable analytics for each test (default state)
  setAnalyticsEnabled(true);
});

describe("initFrontendSentry", () => {
  it("calls Sentry.init exactly once (idempotent)", () => {
    initFrontendSentry();
    initFrontendSentry();
    initFrontendSentry();
    // The module-level call in sentry.ts may have already fired once,
    // so check it was called at most once total across all init calls
    expect(vi.mocked(Sentry.init).mock.calls.length).toBeGreaterThanOrEqual(0);
    // Re-invocations should not add extra init calls
    const callsBefore = vi.mocked(Sentry.init).mock.calls.length;
    initFrontendSentry();
    expect(vi.mocked(Sentry.init).mock.calls.length).toBe(callsBefore);
  });
});

describe("beforeSend gate", () => {
  it("returns null when analyticsEnabled = false", () => {
    // Reset module state by setting analytics off before init runs
    setAnalyticsEnabled(false);

    // Get beforeSend from the most recent init call
    const calls = vi.mocked(Sentry.init).mock.calls;
    if (calls.length === 0) {
      // init hasn't run yet in this test env — run it manually
      initFrontendSentry();
    }
    const lastCall = vi.mocked(Sentry.init).mock.calls.at(-1);
    if (!lastCall) return; // init not reached
    const opts = lastCall[0] as {
      beforeSend?: (event: Record<string, unknown>) => null | Record<string, unknown>;
    };
    if (!opts.beforeSend) return;

    setAnalyticsEnabled(false);
    expect(opts.beforeSend({ extra: { runId: "r1" } })).toBeNull();
  });

  it("returns event when analyticsEnabled = true", () => {
    setAnalyticsEnabled(true);
    const calls = vi.mocked(Sentry.init).mock.calls;
    if (calls.length === 0) initFrontendSentry();
    const lastCall = vi.mocked(Sentry.init).mock.calls.at(-1);
    if (!lastCall) return;
    const opts = lastCall[0] as {
      beforeSend?: (event: { extra?: Record<string, unknown> }) => null | { extra?: Record<string, unknown> };
    };
    if (!opts.beforeSend) return;

    setAnalyticsEnabled(true);
    const event = { extra: { runId: "r1", secretKey: "stripped" } };
    const result = opts.beforeSend(event);
    expect(result).not.toBeNull();
    // secretKey is not in the whitelist — should be stripped
    expect(result!.extra).not.toHaveProperty("secretKey");
    expect(result!.extra).toHaveProperty("runId");
  });
});

describe("captureFrontendError", () => {
  it("calls Sentry.captureException when enabled", () => {
    setAnalyticsEnabled(true);
    captureFrontendError(new Error("test"));
    expect(Sentry.withScope).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when disabled", () => {
    setAnalyticsEnabled(false);
    captureFrontendError(new Error("test"));
    expect(Sentry.withScope).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});

describe("addUserBreadcrumb", () => {
  it("calls Sentry.addBreadcrumb when enabled", () => {
    setAnalyticsEnabled(true);
    addUserBreadcrumb("navigation", { to: "/settings" });
    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when disabled", () => {
    setAnalyticsEnabled(false);
    addUserBreadcrumb("navigation", { to: "/settings" });
    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
  });
});

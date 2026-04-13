/**
 * Demo mode error handling.
 *
 * DemoReadOnlyError is thrown by the transport layer when a visitor in a
 * public demo attempts a write operation. It's caught either locally by
 * mutation callsites (to show inline feedback) or globally by the
 * unhandledrejection handler installed in main.tsx — which opens the
 * signup modal so every write attempt converts into a "sign up" moment.
 *
 * This is layer 2 of the 3-layer defence:
 *   1. Supabase RLS (authoritative — demo rows aren't owned by anon auth.uid)
 *   2. Transport guard (this file — instant UX, no network roundtrip)
 *   3. <DemoGate> UI wrappers (future — hide buttons entirely for some views)
 */

export class DemoReadOnlyError extends Error {
  readonly isDemoReadOnly = true;
  readonly method: string;

  constructor(method: string) {
    super(`Demo mode is read-only (${method}). Sign up to unlock writes.`);
    this.name = "DemoReadOnlyError";
    this.method = method;
    // Preserve prototype for instanceof checks across transpilation.
    Object.setPrototypeOf(this, DemoReadOnlyError.prototype);
  }
}

/** JSON-RPC error code the Worker returns when a demo rate limit is hit. */
export const DEMO_RATE_LIMIT_ERROR_CODE = 4290;

export class DemoRateLimitError extends Error {
  readonly isDemoRateLimit = true;
  readonly reason: string;

  constructor(reason: string) {
    super(`Demo rate limit hit: ${reason}`);
    this.name = "DemoRateLimitError";
    this.reason = reason;
    Object.setPrototypeOf(this, DemoRateLimitError.prototype);
  }
}

export function isDemoReadOnlyError(err: unknown): err is DemoReadOnlyError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { isDemoReadOnly?: boolean }).isDemoReadOnly === true
  );
}

export function isDemoRateLimitError(err: unknown): err is DemoRateLimitError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { isDemoRateLimit?: boolean }).isDemoRateLimit === true
  );
}

/**
 * Wire up a global unhandledrejection handler that surfaces DemoReadOnlyError
 * and DemoRateLimitError as the signup modal. Call once at app startup.
 *
 * The handler dynamically imports the demo store so this module stays free
 * of React / Zustand dependencies and is safe to use in tests.
 */
export function installDemoErrorHandler(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    if (isDemoReadOnlyError(reason)) {
      event.preventDefault();
      void Promise.all([
        import("../stores/demo-store"),
        import("./posthog"),
      ]).then(([{ useDemoStore }, { captureEvent }]) => {
        captureEvent("demo_write_blocked", { method: reason.method });
        useDemoStore.getState().showSignupModal({
          trigger: "write_blocked",
          method: reason.method,
        });
      });
      return;
    }
    if (isDemoRateLimitError(reason)) {
      event.preventDefault();
      void Promise.all([
        import("../stores/demo-store"),
        import("./posthog"),
      ]).then(([{ useDemoStore }, { captureEvent }]) => {
        captureEvent("demo_rate_limit_hit", { reason: reason.reason });
        useDemoStore.getState().showSignupModal({
          trigger: "rate_limit",
          reason: reason.reason,
        });
      });
    }
  });
}

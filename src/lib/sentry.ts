/**
 * Sentry integration for the OpenOrchestra frontend.
 * Initialized once at module load. Analytics can be toggled at runtime.
 */

import * as Sentry from "@sentry/react";

// Optimistic default: enabled until settings load (race window ~1-2s)
let analyticsEnabled = true;
let initialized = false;

// Whitelisted extra keys — anything else is stripped in beforeSend
const ALLOWED_EXTRA_KEYS = new Set([
  "method",
  "jobId",
  "runId",
  "goalId",
  "errorCode",
  "ipcMethod",
]);

/** Initialize Sentry. Idempotent — safe to call multiple times. */
export function initFrontendSentry(): void {
  if (initialized) return;
  initialized = true;

  try {
    Sentry.init({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dsn: (import.meta as any).env?.VITE_SENTRY_DSN ?? "",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      environment: (import.meta as any).env?.MODE === "production" ? "production" : "development",
      release: "openorchestra@0.1.0",
      tracesSampleRate: 0.1,
      beforeSend(event) {
        if (!analyticsEnabled) return null;
        // Strip non-whitelisted extra keys (privacy guard)
        if (event.extra) {
          const filtered: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(event.extra)) {
            if (ALLOWED_EXTRA_KEYS.has(k)) filtered[k] = v;
          }
          event.extra = filtered;
        }
        return event;
      },
    });
  } catch (err) {
    console.error("[sentry] frontend init failed:", err);
  }
}

/** Enable or disable Sentry event reporting. Takes effect immediately. */
export function setAnalyticsEnabled(enabled: boolean): void {
  analyticsEnabled = enabled;
}

/** Capture an exception with optional whitelisted context. No-op when disabled. */
export function captureFrontendError(
  err: unknown,
  context?: Record<string, unknown>,
): void {
  if (!analyticsEnabled) return;
  try {
    Sentry.withScope((scope) => {
      if (context) {
        for (const [k, v] of Object.entries(context)) {
          if (ALLOWED_EXTRA_KEYS.has(k)) scope.setExtra(k, v);
        }
      }
      Sentry.captureException(
        err instanceof Error ? err : new Error(String(err)),
      );
    });
  } catch {
    // Swallow — Sentry must never break the UI
  }
}

/** Add a breadcrumb. No-op when disabled. */
export function addUserBreadcrumb(
  category: string,
  data: Record<string, string>,
): void {
  if (!analyticsEnabled) return;
  try {
    Sentry.addBreadcrumb({ category, data });
  } catch {
    // Swallow
  }
}

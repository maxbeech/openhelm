/**
 * Sentry integration for the OpenOrchestra agent sidecar.
 * Reads analytics_enabled from DB and gates all Sentry operations accordingly.
 * All operations are wrapped in try/catch — Sentry failure must never crash the agent.
 */

import * as Sentry from "@sentry/node";
import { getSetting } from "./db/queries/settings.js";

// Whitelisted extra keys — anything else is stripped in beforeSend
const ALLOWED_EXTRA_KEYS = new Set([
  "runId",
  "jobId",
  "exitCode",
  "method",
  "errorCode",
]);

// Synchronous enabled flag — set during init, read in captureAgentError / addAgentBreadcrumb
let _enabled = false;

/** Initialize Sentry for the agent. Call once after DB init. Non-throwing. */
export function initAgentSentry(): void {
  try {
    const setting = getSetting("analytics_enabled");
    _enabled = setting?.value !== "false";

    Sentry.init({
      dsn: process.env.SENTRY_DSN ?? "",
      environment:
        process.env.NODE_ENV === "production" ? "production" : "development",
      release: "openorchestra@0.1.0",
      tracesSampleRate: 0.1,
      skipOpenTelemetrySetup: true,
      beforeSend(event) {
        if (!_enabled) return null;
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

    if (!_enabled) {
      // Shut down the client immediately so no events are flushed
      Sentry.close(0).catch(() => {});
    }
  } catch (err) {
    console.error("[sentry] init failed (non-fatal):", err);
    _enabled = false;
  }
}

/** Capture an exception in Sentry with optional whitelisted context. No-op when disabled. */
export function captureAgentError(
  err: unknown,
  context?: Record<string, unknown>,
): void {
  if (!_enabled) return;
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
    // Swallow — Sentry must never crash the agent
  }
}

/** Add a breadcrumb (non-exception event). No-op when disabled. */
export function addAgentBreadcrumb(
  category: string,
  data: Record<string, string | number | null>,
): void {
  if (!_enabled) return;
  try {
    Sentry.addBreadcrumb({ category, data: data as Record<string, string> });
  } catch {
    // Swallow
  }
}

/** Whether Sentry analytics is currently enabled. Used in tests. */
export function isAnalyticsEnabled(): boolean {
  return _enabled;
}

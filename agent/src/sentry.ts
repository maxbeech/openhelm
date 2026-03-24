/**
 * Sentry integration for the OpenHelm agent sidecar.
 * Reads analytics_enabled from DB and gates all Sentry operations accordingly.
 * All operations are wrapped in try/catch — Sentry failure must never crash the agent.
 */

import * as Sentry from "@sentry/node";
import { getSetting } from "./db/queries/settings.js";

// Injected at build time by esbuild define — see agent/scripts/build.mjs
declare const __OPENHELM_VERSION__: string;

// Whitelisted extra keys — anything else is stripped in beforeSend
const ALLOWED_EXTRA_KEYS = new Set([
  "runId",
  "jobId",
  "exitCode",
  "method",
  "errorCode",
  "healthCheckStderr",
  "healthCheckCode",
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
      release: `openhelm@${typeof __OPENHELM_VERSION__ !== "undefined" ? __OPENHELM_VERSION__ : "unknown"}`,
      tracesSampleRate: 0.1,
      skipOpenTelemetrySetup: true,
      integrations: [
        Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
      ],
      enableLogs: true,
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
      beforeSendLog(log) {
        if (!_enabled) return null;
        return log;
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

// Deduplicate errors within a session: map of fingerprint → last-reported timestamp
const _reported = new Map<string, number>();
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/** Capture an exception in Sentry with optional whitelisted context. No-op when disabled.
 *  Deduplicates identical errors within a 5-minute window to avoid flooding Sentry. */
export function captureAgentError(
  err: unknown,
  context?: Record<string, unknown>,
): void {
  if (!_enabled) return;
  try {
    const error = err instanceof Error ? err : new Error(String(err));
    const fingerprint = `${context?.errorCode ?? "unknown"}:${error.message}`;
    const now = Date.now();
    const last = _reported.get(fingerprint) ?? 0;
    if (now - last < DEDUP_WINDOW_MS) return; // already reported recently
    _reported.set(fingerprint, now);

    Sentry.withScope((scope) => {
      if (context) {
        for (const [k, v] of Object.entries(context)) {
          if (ALLOWED_EXTRA_KEYS.has(k)) scope.setExtra(k, v);
        }
        // Set errorCode as a tag for easy Sentry filtering
        if (typeof context.errorCode === "string") {
          scope.setTag("errorCode", context.errorCode);
        }
      }
      Sentry.captureException(error);
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

/**
 * PostHog integration for the OpenHelm frontend.
 *
 * Basic anonymous event tracking is always active.
 * Session recording is enabled only when the user has opted into
 * "Share anonymous error reports" (analytics_enabled setting).
 */

import posthog from "posthog-js";

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;

let initialized = false;

/** Initialize PostHog. Idempotent — safe to call multiple times. */
export function initPostHog(): void {
  if (initialized) return;
  initialized = true;

  if (!POSTHOG_KEY) return;

  try {
    posthog.init(POSTHOG_KEY, {
      api_host: "https://eu.i.posthog.com",
      // Tauri SPA — no URL-based pageviews
      capture_pageview: false,
      capture_pageleave: false,
      // Manual events only; no DOM click-capture
      autocapture: false,
      // Fully anonymous — no person profiles or user IDs
      person_profiles: "never",
      // Session recording off by default; enabled via setRecordingEnabled()
      disable_session_recording: true,
      // Stable anonymous device identity across launches
      persistence: "localStorage",
    });
  } catch (err) {
    console.error("[posthog] init failed:", err);
  }
}

/**
 * Enable or disable session recording.
 * Call with the current analytics_enabled setting value on load and on toggle.
 */
export function setRecordingEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      posthog.startSessionRecording();
    } else {
      posthog.stopSessionRecording();
    }
  } catch {
    // Never throw — PostHog must not break the UI
  }
}

/** Capture an anonymous event. Always fires regardless of recording preference. */
export function captureEvent(
  event: string,
  properties?: Record<string, string | number | boolean>,
): void {
  try {
    posthog.capture(event, properties);
  } catch {
    // Swallow
  }
}

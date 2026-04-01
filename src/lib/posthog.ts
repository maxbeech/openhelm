/**
 * PostHog integration for the OpenHelm frontend.
 *
 * Basic anonymous event tracking is always active.
 * Session recording is enabled only when the user has opted into
 * "Share anonymous error reports" (analytics_enabled setting).
 *
 * Identity: each device gets a stable random UUID stored in localStorage
 * and passed to posthog.identify() — fully anonymous, no PII, but enables
 * accurate DAU/WAU/MAU, new-user detection, and retention cohorts.
 */

import posthog from "posthog-js";

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const DEVICE_ID_KEY = "openhelm_device_id";

let initialized = false;

/**
 * Get or create a stable anonymous device ID.
 * Uses crypto.randomUUID() where available, falls back to Math.random().
 */
function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id =
      typeof crypto?.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    // localStorage unavailable (e.g. private mode restrictions)
    return "unknown";
  }
}

/**
 * Identify the current device with PostHog using its anonymous UUID.
 * Must be called after initPostHog(). Safe to call multiple times.
 */
export function identifyDevice(): void {
  try {
    const deviceId = getOrCreateDeviceId();
    if (deviceId !== "unknown") {
      posthog.identify(deviceId);
    }
  } catch {
    // Never throw — PostHog must not break the UI
  }
}

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
      // Person profiles only for identified devices (enables DAU/retention metrics)
      person_profiles: "identified_only",
      // Session recording off by default; enabled via setRecordingEnabled()
      disable_session_recording: true,
      // Stable anonymous device identity across launches
      persistence: "localStorage",
    });

    // Identify immediately so the very first event is attributed to this device
    identifyDevice();
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

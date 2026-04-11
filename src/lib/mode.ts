/**
 * Runtime mode detection.
 *
 * Local mode: running inside Tauri desktop app (window.__TAURI_INTERNALS__ exists — Tauri v2)
 * Cloud mode: running in a browser without Tauri
 */

declare const window: { __TAURI_INTERNALS__?: unknown } & Window;

export const isLocalMode =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const isCloudMode = !isLocalMode;

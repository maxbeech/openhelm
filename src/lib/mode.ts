/**
 * Runtime mode detection.
 *
 * Local mode: running inside Tauri desktop app (window.__TAURI_INTERNALS__ exists — Tauri v2)
 * Cloud mode: running in a browser without Tauri
 */

declare const window: { __TAURI_INTERNALS__?: unknown } & Window;

export const isLocalMode =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window ||
    new URLSearchParams(window.location.search).get("local") === "1");

export const isCloudMode = !isLocalMode;

/** True when the given pathname is scoped to a public demo (/demo/:slug/...). */
export function isDemoPath(pathname: string): boolean {
  return pathname.startsWith("/demo/");
}

/** Extract the demo slug from a pathname, or null if not a demo path. */
export function getDemoSlug(pathname: string): string | null {
  const match = pathname.match(/^\/demo\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

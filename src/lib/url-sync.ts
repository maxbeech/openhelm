/**
 * Pure helpers mapping OpenHelm's `contentView` + selection IDs to a URL
 * path and back. Kept free of React/Zustand so the logic is unit-testable
 * in isolation.
 *
 * `selectedRunId` is intentionally NOT in the URL — runs are a right-side
 * panel layered over job-detail/dashboard, not a distinct page.
 * `activeProjectId` is also excluded — it's a cross-view filter.
 */

import type { ContentView } from "@/stores/app-store";

export interface UrlState {
  contentView: ContentView;
  selectedGoalId: string | null;
  selectedJobId: string | null;
  selectedDataTableId: string | null;
}

const DEFAULT_STATE: UrlState = {
  contentView: "inbox",
  selectedGoalId: null,
  selectedJobId: null,
  selectedDataTableId: null,
};

/** Compute the canonical path for the given URL-relevant app state. */
export function contentViewToPath(s: UrlState): string {
  switch (s.contentView) {
    case "inbox":
      return "/inbox";
    case "home":
      return "/home";
    case "dashboard":
      return "/dashboard";
    case "memory":
      return "/memory";
    case "credentials":
      return "/credentials";
    case "settings":
      return "/settings";
    case "data-tables":
      return "/data";
    case "data-table-detail":
      return s.selectedDataTableId
        ? `/data/${encodeURIComponent(s.selectedDataTableId)}`
        : "/data";
    case "goal-detail":
      return s.selectedGoalId
        ? `/goals/${encodeURIComponent(s.selectedGoalId)}`
        : "/inbox";
    case "job-detail":
      return s.selectedJobId
        ? `/jobs/${encodeURIComponent(s.selectedJobId)}`
        : "/inbox";
  }
}

/**
 * Parse a pathname into a full `UrlState`. Returns `null` for unknown
 * routes so callers can redirect to the default view.
 *
 * Always returns all four selection fields (with nulls where irrelevant)
 * so `setState` with the result also clears stale selections.
 */
export function pathToState(pathname: string): UrlState | null {
  // Normalize: strip trailing slash (except for root), collapse empty → "/"
  const normalized =
    pathname === "" || pathname === "/"
      ? "/"
      : pathname.replace(/\/+$/, "");

  if (normalized === "/") return { ...DEFAULT_STATE };

  const segments = normalized.slice(1).split("/");
  const [first, second, ...rest] = segments;
  if (rest.length > 0) return null; // no deeper routes defined

  switch (first) {
    case "inbox":
      if (second) return null;
      return { ...DEFAULT_STATE, contentView: "inbox" };
    case "home":
      if (second) return null;
      return { ...DEFAULT_STATE, contentView: "home" };
    case "dashboard":
      if (second) return null;
      return { ...DEFAULT_STATE, contentView: "dashboard" };
    case "memory":
      if (second) return null;
      return { ...DEFAULT_STATE, contentView: "memory" };
    case "credentials":
      if (second) return null;
      return { ...DEFAULT_STATE, contentView: "credentials" };
    case "settings":
      if (second) return null;
      return { ...DEFAULT_STATE, contentView: "settings" };
    case "data":
      if (!second) {
        return { ...DEFAULT_STATE, contentView: "data-tables" };
      }
      return {
        ...DEFAULT_STATE,
        contentView: "data-table-detail",
        selectedDataTableId: decodeURIComponent(second),
      };
    case "goals":
      if (!second) return null;
      return {
        ...DEFAULT_STATE,
        contentView: "goal-detail",
        selectedGoalId: decodeURIComponent(second),
      };
    case "jobs":
      if (!second) return null;
      return {
        ...DEFAULT_STATE,
        contentView: "job-detail",
        selectedJobId: decodeURIComponent(second),
      };
    default:
      return null;
  }
}

/** True when a pathname should be owned by the demo experience (bypass sync). */
export function isDemoPathname(pathname: string): boolean {
  return pathname.startsWith("/demo/") || pathname === "/demo";
}

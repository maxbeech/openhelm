/**
 * useUrlSync — two-way binding between `app-store` navigation state and the
 * browser URL.
 *
 * Why this exists: OpenHelm's in-app navigation is Zustand-driven via
 * `contentView` + selection IDs. This hook keeps the URL in sync so that
 * clicking the sidebar updates the address bar, browser back/forward works,
 * refresh preserves the view, and deep links hydrate straight into the
 * right page.
 *
 * Design notes:
 *  - `app-store` remains the single source of truth.
 *  - URL → store writes bypass `setContentView`/`selectGoal`/etc. so they
 *    do NOT push a `nav-store` entry. In-app navigation continues to push
 *    `nav-store` as before, and the store→URL effect reflects the change.
 *  - `/demo/:slug/*` is untouched — the demo experience owns its URL.
 *  - Loop guard: `lastSyncedPathRef` is the single tombstone read/written
 *    in both directions.
 */

import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/app-store";
import { useDemoStore } from "@/stores/demo-store";
import { useNavStore } from "@/stores/nav-store";
import {
  contentViewToPath,
  pathToState,
  isDemoPathname,
  type UrlState,
} from "@/lib/url-sync";

export function useUrlSync(): void {
  const location = useLocation();
  const navigate = useNavigate();
  const contentView = useAppStore((s) => s.contentView);
  const selectedGoalId = useAppStore((s) => s.selectedGoalId);
  const selectedJobId = useAppStore((s) => s.selectedJobId);
  const selectedDataTableId = useAppStore((s) => s.selectedDataTableId);

  const lastSyncedPathRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);

  // Effect 1: first-mount hydration. Read the URL once and push it into
  // app-store directly (bypassing setContentView so we don't push a
  // nav-store entry on hydration). Demo paths are skipped.
  //
  // Must be a `useLayoutEffect` — otherwise effect 2 (store → URL) fires
  // after this one in the same commit phase and reads stale closure state,
  // navigating the URL back to whatever `contentView` was before hydration.
  // `useLayoutEffect` lets React process the `setState` synchronously and
  // re-run effects with fresh closures before the next paint.
  useLayoutEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    if (isDemoPathname(location.pathname)) return;
    if (useDemoStore.getState().isDemo) return;

    const parsed = pathToState(location.pathname);
    if (!parsed) {
      // Unknown route — redirect to default, marked so the store→URL
      // effect doesn't fight us.
      lastSyncedPathRef.current = "/inbox";
      navigate("/inbox", { replace: true });
      return;
    }

    lastSyncedPathRef.current = contentViewToPath(parsed);
    useAppStore.setState({
      contentView: parsed.contentView,
      selectedGoalId: parsed.selectedGoalId,
      selectedJobId: parsed.selectedJobId,
      selectedDataTableId: parsed.selectedDataTableId,
      selectedRunId: null,
    });
    // If the URL lacked a leading canonical form (e.g. "/"), reflect the
    // canonical version without adding a history entry.
    if (location.pathname !== lastSyncedPathRef.current) {
      navigate(lastSyncedPathRef.current, { replace: true });
    }
    // Intentionally run only once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect 2: store → URL reflection. Whenever the relevant slice of
  // app-store changes, compute the canonical path and navigate if it
  // differs from the current location.
  //
  // Reads via `useAppStore.getState()` rather than the closure values from
  // the hook's selectors. On the first commit after layout-effect
  // hydration, the closure is still one render behind (Zustand's external
  // store subscription hasn't re-rendered yet), but `getState()` is live.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (isDemoPathname(location.pathname)) return;
    if (useDemoStore.getState().isDemo) return;

    const s = useAppStore.getState();
    const state: UrlState = {
      contentView: s.contentView,
      selectedGoalId: s.selectedGoalId,
      selectedJobId: s.selectedJobId,
      selectedDataTableId: s.selectedDataTableId,
    };
    const target = contentViewToPath(state);
    if (target === location.pathname) return;
    if (target === lastSyncedPathRef.current) return;

    lastSyncedPathRef.current = target;
    navigate(target);
  }, [
    contentView,
    selectedGoalId,
    selectedJobId,
    selectedDataTableId,
    location.pathname,
    navigate,
  ]);

  // Effect 3: URL → store reflection. Fires when the location changes
  // from something other than our own programmatic navigation — i.e.
  // browser back/forward, or a manual URL edit.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (isDemoPathname(location.pathname)) return;
    if (useDemoStore.getState().isDemo) return;
    if (location.pathname === lastSyncedPathRef.current) return;

    const parsed = pathToState(location.pathname);
    if (!parsed) {
      lastSyncedPathRef.current = "/inbox";
      navigate("/inbox", { replace: true });
      return;
    }

    lastSyncedPathRef.current = location.pathname;

    // Nudge slide direction: if the target matches the top of nav-store.past,
    // treat as a back navigation; otherwise forward.
    const past = useNavStore.getState().past;
    const topOfPast = past.length > 0 ? past[past.length - 1] : null;
    const navDirection =
      topOfPast && topOfPast.contentView === parsed.contentView ? "back" : "forward";
    useNavStore.setState({ navDirection });

    useAppStore.setState({
      contentView: parsed.contentView,
      selectedGoalId: parsed.selectedGoalId,
      selectedJobId: parsed.selectedJobId,
      selectedDataTableId: parsed.selectedDataTableId,
      // Always clear the run panel on URL-driven navigation so an orphaned
      // panel can't linger over a different view.
      selectedRunId: null,
    });
  }, [location.pathname, navigate]);
}

import { create } from "zustand";
import type { ContentView } from "./app-store";

/**
 * Snapshot of navigation state at a point in time.
 * Stores everything needed to restore the view exactly as it was.
 */
export interface NavEntry {
  contentView: ContentView;
  selectedGoalId: string | null;
  selectedJobId: string | null;
  selectedRunId: string | null;
  selectedDataTableId: string | null;
  scrollTop: number;
  tierThreshold: number;
}

export type NavDirection = "forward" | "back";

interface NavState {
  past: NavEntry[];
  future: NavEntry[];
  canGoBack: boolean;
  canGoForward: boolean;
  /** Direction of the most recent navigation — drives slide animation. */
  navDirection: NavDirection;

  /** Record a navigation event. Call this BEFORE changing the app store. */
  push: (entry: NavEntry) => void;
  /** Go back one step. Returns the entry to restore, or null. */
  goBack: (current: NavEntry) => NavEntry | null;
  /** Go forward one step. Returns the entry to restore, or null. */
  goForward: (current: NavEntry) => NavEntry | null;
}

const MAX_HISTORY = 50;

export const useNavStore = create<NavState>((set, get) => ({
  past: [],
  future: [],
  canGoBack: false,
  canGoForward: false,
  navDirection: "forward",

  push: (entry) => {
    set((s) => {
      const past = [...s.past, entry].slice(-MAX_HISTORY);
      return { past, future: [], canGoBack: true, canGoForward: false, navDirection: "forward" };
    });
  },

  goBack: (current) => {
    const { past } = get();
    if (past.length === 0) return null;
    const prev = past[past.length - 1];
    set((s) => ({
      past: s.past.slice(0, -1),
      future: [current, ...s.future].slice(0, MAX_HISTORY),
      canGoBack: s.past.length > 1,
      canGoForward: true,
      navDirection: "back",
    }));
    return prev;
  },

  goForward: (current) => {
    const { future } = get();
    if (future.length === 0) return null;
    const next = future[0];
    set((s) => ({
      past: [...s.past, current].slice(-MAX_HISTORY),
      future: s.future.slice(1),
      canGoBack: true,
      canGoForward: s.future.length > 1,
      navDirection: "forward",
    }));
    return next;
  },
}));

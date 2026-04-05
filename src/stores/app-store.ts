import { create } from "zustand";
import type { SortMode } from "@openhelm/shared";
import * as api from "@/lib/api";
import { useNavStore, type NavEntry } from "./nav-store";
import { useInboxStore } from "./inbox-store";

// Navigation model — run detail is a side panel, not a content view
export type ContentView =
  | "home"
  | "inbox"
  | "goal-detail"
  | "job-detail"
  | "dashboard"
  | "memory"
  | "data-tables"
  | "data-table-detail"
  | "credentials"
  | "settings";

interface AppState {
  // Navigation
  contentView: ContentView;
  selectedGoalId: string | null;
  selectedJobId: string | null;
  selectedRunId: string | null;
  selectedDataTableId: string | null;
  collapsedGoalIds: string[];
  collapsedProjectIds: string[];

  // Sidebar sorting
  goalSortMode: SortMode;
  jobSortMode: SortMode;

  // Sidebar view options
  groupByProject: boolean;
  sidebarSearch: string;
  projectGroupOrder: string[]; // ordered project IDs for custom group sort

  // Existing — null means "All Projects"
  activeProjectId: string | null;
  onboardingComplete: boolean;
  agentReady: boolean;

  // Navigation actions
  selectGoal: (goalId: string) => void;
  selectJob: (jobId: string) => void;
  selectRun: (runId: string, jobId?: string) => void;
  // Select a run without changing the current content view (used from Dashboard)
  selectRunPreserveView: (runId: string) => void;
  clearSelectedRun: () => void;
  selectDataTable: (tableId: string) => void;
  toggleGoalCollapsed: (goalId: string) => void;
  toggleProjectCollapsed: (projectId: string) => void;
  setContentView: (view: ContentView) => void;

  // Sorting
  setGoalSortMode: (mode: SortMode) => void;
  setJobSortMode: (mode: SortMode) => void;

  // Sidebar view options
  setGroupByProject: (on: boolean) => void;
  setSidebarSearch: (q: string) => void;
  setProjectGroupOrder: (ids: string[]) => void;
  setCollapsedGoalIds: (ids: string[]) => void;

  // Navigation history
  navigateBack: () => void;
  navigateForward: () => void;

  // Existing
  setActiveProjectId: (id: string | null) => void;
  setOnboardingComplete: (complete: boolean) => void;
  setAgentReady: (ready: boolean) => void;
}

/** Find the active scrollable element — inbox has its own scroll container. */
function getScrollElement(): HTMLElement | null {
  // Inbox timeline uses its own overflow-y-auto div inside <main>
  return document.querySelector("main [class*='overflow-y-auto']")
    ?? document.querySelector("main");
}

/** Capture current navigation state as a NavEntry (for back/forward history). */
function captureNavEntry(s: AppState): NavEntry {
  const scrollEl = getScrollElement();
  const scrollTop = scrollEl?.scrollTop ?? 0;
  const tierThreshold = useInboxStore.getState().tierThreshold;
  return {
    contentView: s.contentView,
    selectedGoalId: s.selectedGoalId,
    selectedJobId: s.selectedJobId,
    selectedRunId: s.selectedRunId,
    selectedDataTableId: s.selectedDataTableId,
    scrollTop,
    tierThreshold,
  };
}

/** Restore a NavEntry: set app state and schedule scroll/tier restoration. */
function restoreNavEntry(entry: NavEntry, set: (partial: Partial<AppState>) => void) {
  set({
    contentView: entry.contentView,
    selectedGoalId: entry.selectedGoalId,
    selectedJobId: entry.selectedJobId,
    selectedRunId: entry.selectedRunId,
    selectedDataTableId: entry.selectedDataTableId,
  });
  // Restore inbox tier threshold
  useInboxStore.getState().setTierThreshold(entry.tierThreshold);
  // Restore scroll position after the view re-renders (double rAF to wait for layout)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const scrollEl = getScrollElement();
      if (scrollEl) scrollEl.scrollTop = entry.scrollTop;
    });
  });
}

export const useAppStore = create<AppState>((set, get) => ({
  contentView: "inbox",
  selectedGoalId: null,
  selectedJobId: null,
  selectedRunId: null,
  selectedDataTableId: null,
  collapsedGoalIds: [],
  collapsedProjectIds: [],

  goalSortMode: "custom",
  jobSortMode: "custom",

  groupByProject: false,
  sidebarSearch: "",
  projectGroupOrder: [],

  activeProjectId: null,
  onboardingComplete: false,
  agentReady: false,

  selectGoal: (goalId) => {
    useNavStore.getState().push(captureNavEntry(get()));
    set({
      contentView: "goal-detail",
      selectedGoalId: goalId,
      selectedJobId: null,
      selectedRunId: null,
    });
  },

  selectJob: (jobId) => {
    useNavStore.getState().push(captureNavEntry(get()));
    set({
      contentView: "job-detail",
      selectedJobId: jobId,
      selectedRunId: null,
    });
  },

  // Run detail is a side panel — don't change contentView
  selectRun: (runId, jobId) => {
    useNavStore.getState().push(captureNavEntry(get()));
    set((s) => ({
      selectedRunId: runId,
      selectedJobId: jobId ?? s.selectedJobId,
      contentView: (jobId ?? s.selectedJobId) ? "job-detail" : s.contentView,
    }));
  },

  // Select a run without switching away from the current view (e.g. from Dashboard)
  selectRunPreserveView: (runId) => set({ selectedRunId: runId }),

  clearSelectedRun: () => set({ selectedRunId: null }),

  selectDataTable: (tableId) => {
    useNavStore.getState().push(captureNavEntry(get()));
    set({ contentView: "data-table-detail", selectedDataTableId: tableId });
  },

  toggleGoalCollapsed: (goalId) =>
    set((s) => ({
      collapsedGoalIds: s.collapsedGoalIds.includes(goalId)
        ? s.collapsedGoalIds.filter((id) => id !== goalId)
        : [...s.collapsedGoalIds, goalId],
    })),

  toggleProjectCollapsed: (projectId) =>
    set((s) => ({
      collapsedProjectIds: s.collapsedProjectIds.includes(projectId)
        ? s.collapsedProjectIds.filter((id) => id !== projectId)
        : [...s.collapsedProjectIds, projectId],
    })),

  setContentView: (view) => {
    useNavStore.getState().push(captureNavEntry(get()));
    const clearSelections = view === "home" || view === "settings" || view === "inbox" || view === "dashboard" || view === "memory" || view === "data-tables";
    set({
      contentView: view,
      ...(clearSelections && { selectedGoalId: null, selectedJobId: null, selectedRunId: null, selectedDataTableId: null }),
    });
  },

  setGoalSortMode: (mode) => set({ goalSortMode: mode }),
  setJobSortMode: (mode) => set({ jobSortMode: mode }),

  setGroupByProject: (on) => set({ groupByProject: on }),
  setSidebarSearch: (q) => set({ sidebarSearch: q }),
  setCollapsedGoalIds: (ids) => set({ collapsedGoalIds: ids }),
  setProjectGroupOrder: (ids) => {
    set({ projectGroupOrder: ids });
    api.setSetting({ key: "sidebar_project_group_order", value: JSON.stringify(ids) }).catch(() => {});
  },

  navigateBack: () => {
    const entry = useNavStore.getState().goBack(captureNavEntry(get()));
    if (entry) restoreNavEntry(entry, set);
  },

  navigateForward: () => {
    const entry = useNavStore.getState().goForward(captureNavEntry(get()));
    if (entry) restoreNavEntry(entry, set);
  },

  // When switching project filter, don't change contentView — stay on dashboard
  setActiveProjectId: (id) =>
    set({
      activeProjectId: id,
      selectedGoalId: null,
      selectedJobId: null,
      selectedRunId: null,
    }),
  setOnboardingComplete: (complete) => set({ onboardingComplete: complete }),
  setAgentReady: (ready) => set({ agentReady: ready }),
}));

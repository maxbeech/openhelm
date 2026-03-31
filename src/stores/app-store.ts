import { create } from "zustand";
import type { SortMode } from "@openhelm/shared";
import * as api from "@/lib/api";

// Navigation model — run detail is a side panel, not a content view
export type ContentView =
  | "home"
  | "goal-detail"
  | "job-detail"
  | "dashboard"
  | "memory"
  | "data-tables"
  | "data-table-detail"
  | "credentials"
  | "settings";

// Backward-compat alias
export type Page = "goals" | "jobs" | "runs" | "settings";

export interface NavigationFilter {
  goalId?: string;
  jobId?: string;
  runId?: string;
}

interface AppState {
  // Navigation
  contentView: ContentView;
  selectedGoalId: string | null;
  selectedJobId: string | null;
  selectedRunId: string | null;
  selectedDataTableId: string | null;
  collapsedGoalIds: string[];
  collapsedProjectIds: string[];

  // Legacy
  page: Page;
  filter: NavigationFilter;

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

  // Legacy (maps to new actions)
  setPage: (page: Page, filter?: NavigationFilter) => void;

  // Sorting
  setGoalSortMode: (mode: SortMode) => void;
  setJobSortMode: (mode: SortMode) => void;

  // Sidebar view options
  setGroupByProject: (on: boolean) => void;
  setSidebarSearch: (q: string) => void;
  setProjectGroupOrder: (ids: string[]) => void;
  setCollapsedGoalIds: (ids: string[]) => void;

  // Existing
  setActiveProjectId: (id: string | null) => void;
  setOnboardingComplete: (complete: boolean) => void;
  setAgentReady: (ready: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  contentView: "dashboard",
  selectedGoalId: null,
  selectedJobId: null,
  selectedRunId: null,
  selectedDataTableId: null,
  collapsedGoalIds: [],
  collapsedProjectIds: [],

  page: "goals",
  filter: {},

  goalSortMode: "custom",
  jobSortMode: "custom",

  groupByProject: false,
  sidebarSearch: "",
  projectGroupOrder: [],

  activeProjectId: null,
  onboardingComplete: false,
  agentReady: false,

  selectGoal: (goalId) =>
    set({
      contentView: "goal-detail",
      selectedGoalId: goalId,
      selectedJobId: null,
      selectedRunId: null,
    }),

  selectJob: (jobId) =>
    set({
      contentView: "job-detail",
      selectedJobId: jobId,
      selectedRunId: null,
    }),

  // Run detail is a side panel — don't change contentView
  selectRun: (runId, jobId) =>
    set((s) => ({
      selectedRunId: runId,
      selectedJobId: jobId ?? s.selectedJobId,
      contentView: (jobId ?? s.selectedJobId) ? "job-detail" : s.contentView,
    })),

  // Select a run without switching away from the current view (e.g. from Dashboard)
  selectRunPreserveView: (runId) => set({ selectedRunId: runId }),

  clearSelectedRun: () => set({ selectedRunId: null }),

  selectDataTable: (tableId) =>
    set({ contentView: "data-table-detail", selectedDataTableId: tableId }),

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
    const clearSelections = view === "home" || view === "settings" || view === "dashboard" || view === "memory" || view === "data-tables";
    set({
      contentView: view,
      ...(clearSelections && { selectedGoalId: null, selectedJobId: null, selectedRunId: null, selectedDataTableId: null }),
    });
  },

  // Backward-compat: maps old page names to new navigation
  setPage: (page, filter = {}) => {
    if (page === "goals") {
      if (filter.goalId) {
        set({
          contentView: "goal-detail",
          selectedGoalId: filter.goalId,
          page,
          filter,
        });
      } else {
        set({ contentView: "home", page, filter });
      }
    } else if (page === "jobs") {
      if (filter.jobId) {
        set({
          contentView: "job-detail",
          selectedJobId: filter.jobId,
          page,
          filter,
        });
      } else if (filter.goalId) {
        set({
          contentView: "goal-detail",
          selectedGoalId: filter.goalId,
          page,
          filter,
        });
      } else {
        set({ contentView: "home", page, filter });
      }
    } else if (page === "runs") {
      if (filter.runId) {
        set((s) => ({
          selectedRunId: filter.runId,
          selectedJobId: filter.jobId ?? s.selectedJobId,
          contentView: (filter.jobId ?? s.selectedJobId)
            ? "job-detail"
            : s.contentView,
          page,
          filter,
        }));
      } else {
        set({ contentView: "home", page, filter });
      }
    } else if (page === "settings") {
      set({ contentView: "settings", page, filter });
    } else {
      set({ page, filter });
    }
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

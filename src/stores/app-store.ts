import { create } from "zustand";

// New navigation model
export type ContentView =
  | "home"
  | "goal-detail"
  | "job-detail"
  | "run-detail"
  | "settings";

// Backward-compat alias
export type Page = "goals" | "jobs" | "runs" | "settings";

export interface NavigationFilter {
  goalId?: string;
  jobId?: string;
  runId?: string;
}

interface AppState {
  // New navigation
  contentView: ContentView;
  selectedGoalId: string | null;
  selectedJobId: string | null;
  selectedRunId: string | null;
  runsPanelOpen: boolean;
  collapsedGoalIds: string[];

  // Legacy
  page: Page;
  filter: NavigationFilter;

  // Existing
  activeProjectId: string | null;
  onboardingComplete: boolean;
  agentReady: boolean;

  // New actions
  selectGoal: (goalId: string) => void;
  selectJob: (jobId: string) => void;
  selectRun: (runId: string, jobId?: string) => void;
  toggleRunsPanel: () => void;
  toggleGoalCollapsed: (goalId: string) => void;
  setContentView: (view: ContentView) => void;

  // Legacy (maps to new actions)
  setPage: (page: Page, filter?: NavigationFilter) => void;

  // Existing
  setActiveProjectId: (id: string | null) => void;
  setOnboardingComplete: (complete: boolean) => void;
  setAgentReady: (ready: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  contentView: "home",
  selectedGoalId: null,
  selectedJobId: null,
  selectedRunId: null,
  runsPanelOpen: false,
  collapsedGoalIds: [],

  page: "goals",
  filter: {},

  activeProjectId: null,
  onboardingComplete: false,
  agentReady: false,

  selectGoal: (goalId) =>
    set({
      contentView: "goal-detail",
      selectedGoalId: goalId,
      selectedJobId: null,
      selectedRunId: null,
      runsPanelOpen: true,
    }),

  selectJob: (jobId) =>
    set({
      contentView: "job-detail",
      selectedJobId: jobId,
      selectedRunId: null,
      runsPanelOpen: true,
    }),

  selectRun: (runId, jobId) =>
    set((s) => ({
      contentView: "run-detail",
      selectedRunId: runId,
      selectedJobId: jobId ?? s.selectedJobId,
    })),

  toggleRunsPanel: () =>
    set((s) => ({ runsPanelOpen: !s.runsPanelOpen })),

  toggleGoalCollapsed: (goalId) =>
    set((s) => ({
      collapsedGoalIds: s.collapsedGoalIds.includes(goalId)
        ? s.collapsedGoalIds.filter((id) => id !== goalId)
        : [...s.collapsedGoalIds, goalId],
    })),

  setContentView: (view) =>
    set({
      contentView: view,
      selectedGoalId: view === "home" || view === "settings" ? null : undefined,
      selectedJobId: view === "home" || view === "settings" ? null : undefined,
      selectedRunId: view === "home" || view === "settings" ? null : undefined,
    } as Partial<AppState>),

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
        set({
          contentView: "run-detail",
          selectedRunId: filter.runId,
          page,
          filter,
        });
      } else {
        set({ contentView: "home", page, filter });
      }
    } else if (page === "settings") {
      set({ contentView: "settings", page, filter });
    } else {
      set({ page, filter });
    }
  },

  setActiveProjectId: (id) =>
    set({
      activeProjectId: id,
      contentView: "home",
      selectedGoalId: null,
      selectedJobId: null,
      selectedRunId: null,
    }),
  setOnboardingComplete: (complete) => set({ onboardingComplete: complete }),
  setAgentReady: (ready) => set({ agentReady: ready }),
}));

import { create } from "zustand";

// Navigation model — run detail is a side panel, not a content view
export type ContentView =
  | "home"
  | "goal-detail"
  | "job-detail"
  | "inbox"
  | "memory"
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
  collapsedGoalIds: string[];

  // Legacy
  page: Page;
  filter: NavigationFilter;

  // Existing — null means "All Projects"
  activeProjectId: string | null;
  onboardingComplete: boolean;
  agentReady: boolean;

  // Navigation actions
  selectGoal: (goalId: string) => void;
  selectJob: (jobId: string) => void;
  selectRun: (runId: string, jobId?: string) => void;
  // Select a run without changing the current content view (used from Inbox)
  selectRunPreserveView: (runId: string) => void;
  clearSelectedRun: () => void;
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
  contentView: "inbox",
  selectedGoalId: null,
  selectedJobId: null,
  selectedRunId: null,
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

  // Select a run without switching away from the current view (e.g. from Inbox)
  selectRunPreserveView: (runId) => set({ selectedRunId: runId }),

  clearSelectedRun: () => set({ selectedRunId: null }),

  toggleGoalCollapsed: (goalId) =>
    set((s) => ({
      collapsedGoalIds: s.collapsedGoalIds.includes(goalId)
        ? s.collapsedGoalIds.filter((id) => id !== goalId)
        : [...s.collapsedGoalIds, goalId],
    })),

  setContentView: (view) => {
    const clearSelections = view === "home" || view === "settings" || view === "inbox" || view === "memory";
    set({
      contentView: view,
      selectedGoalId: clearSelections ? null : undefined,
      selectedJobId: clearSelections ? null : undefined,
      selectedRunId: clearSelections ? null : undefined,
    } as Partial<AppState>);
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

  // When switching project filter, don't change contentView — stay on inbox
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

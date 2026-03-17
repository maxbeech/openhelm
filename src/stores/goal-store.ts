import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { Goal, GoalStatus, CreateGoalParams, UpdateGoalParams } from "@openorchestra/shared";
import * as api from "@/lib/api";
import { friendlyError } from "@/lib/utils";

interface GoalState {
  goals: Goal[];
  loading: boolean;
  error: string | null;

  fetchGoals: (projectId: string | null) => Promise<void>;
  createGoal: (params: CreateGoalParams) => Promise<Goal>;
  updateGoal: (params: UpdateGoalParams) => Promise<Goal>;
  updateGoalStatus: (id: string, status: GoalStatus) => Promise<void>;
  archiveGoal: (id: string) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
}

export const useGoalStore = create<GoalState>((set) => ({
  goals: [],
  loading: false,
  error: null,

  createGoal: async (params) => {
    try {
      const goal = await api.createGoal(params);
      set((s) => ({ goals: [goal, ...s.goals] }));
      return goal;
    } catch (err) {
      set({ error: friendlyError(err, "Failed to create goal") });
      throw err;
    }
  },

  fetchGoals: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const goals = await api.listGoals(projectId ? { projectId } : {});
      set({ goals, loading: false });
    } catch (err) {
      set({
        error: friendlyError(err, "Failed to load goals"),
        loading: false,
      });
    }
  },

  updateGoal: async (params) => {
    try {
      const updated = await api.updateGoal(params);
      set((s) => ({
        goals: s.goals.map((g) => (g.id === params.id ? updated : g)),
      }));
      return updated;
    } catch (err) {
      set({ error: friendlyError(err, "Failed to update goal") });
      throw err;
    }
  },

  updateGoalStatus: async (id, status) => {
    try {
      const updated = await api.updateGoal({ id, status });
      set((s) => ({
        goals: s.goals.map((g) => (g.id === id ? updated : g)),
      }));
    } catch (err) {
      set({ error: friendlyError(err, "Failed to update goal") });
      throw err;
    }
  },

  archiveGoal: async (id) => {
    try {
      const updated = await api.archiveGoal(id);
      set((s) => ({
        goals: s.goals.map((g) => (g.id === id ? updated : g)),
      }));
    } catch (err) {
      set({ error: friendlyError(err, "Failed to archive goal") });
      throw err;
    }
  },

  deleteGoal: async (id) => {
    try {
      await api.deleteGoal(id);
      set((s) => ({ goals: s.goals.filter((g) => g.id !== id) }));
    } catch (err) {
      set({ error: friendlyError(err, "Failed to delete goal") });
      throw err;
    }
  },
}));

/* ── Granular selector hooks ── */
export const useGoals = () => useGoalStore((s) => s.goals);
export const useGoalsLoading = () => useGoalStore((s) => s.loading);
export const useGoalActions = () =>
  useGoalStore(
    useShallow((s) => ({
      fetchGoals: s.fetchGoals,
      createGoal: s.createGoal,
      updateGoal: s.updateGoal,
      updateGoalStatus: s.updateGoalStatus,
      archiveGoal: s.archiveGoal,
      deleteGoal: s.deleteGoal,
    })),
  );

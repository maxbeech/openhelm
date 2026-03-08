import { create } from "zustand";
import type { Goal, GoalStatus } from "@openorchestra/shared";
import * as api from "@/lib/api";
import { friendlyError } from "@/lib/utils";

interface GoalState {
  goals: Goal[];
  loading: boolean;
  error: string | null;

  fetchGoals: (projectId: string) => Promise<void>;
  updateGoalStatus: (id: string, status: GoalStatus) => Promise<void>;
}

export const useGoalStore = create<GoalState>((set) => ({
  goals: [],
  loading: false,
  error: null,

  fetchGoals: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const goals = await api.listGoals({ projectId });
      set({ goals, loading: false });
    } catch (err) {
      set({
        error: friendlyError(err, "Failed to load goals"),
        loading: false,
      });
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
}));

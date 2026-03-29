import { create } from "zustand";
import * as api from "@/lib/api";
import type {
  Target,
  TargetEvaluation,
  CreateTargetParams,
  UpdateTargetParams,
  ListTargetsParams,
} from "@openhelm/shared";

interface TargetState {
  targets: Target[];
  evaluations: TargetEvaluation[];
  loading: boolean;
  error: string | null;

  fetchTargets: (params: ListTargetsParams) => Promise<void>;
  fetchEvaluations: (params: { goalId?: string; jobId?: string }) => Promise<void>;
  createTarget: (params: CreateTargetParams) => Promise<Target | null>;
  updateTarget: (params: UpdateTargetParams) => Promise<void>;
  deleteTarget: (id: string) => Promise<void>;
  clear: () => void;
}

export const useTargetStore = create<TargetState>((set, get) => ({
  targets: [],
  evaluations: [],
  loading: false,
  error: null,

  fetchTargets: async (params) => {
    set({ loading: true, error: null });
    try {
      const targets = await api.listTargets(params);
      set({ targets, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  fetchEvaluations: async (params) => {
    try {
      const evaluations = await api.evaluateTargets(params);
      set({ evaluations });
    } catch (err) {
      console.error("Failed to fetch target evaluations:", err);
    }
  },

  createTarget: async (params) => {
    try {
      const target = await api.createTarget(params);
      set({ targets: [target, ...get().targets] });
      return target;
    } catch (err) {
      set({ error: String(err) });
      return null;
    }
  },

  updateTarget: async (params) => {
    try {
      const updated = await api.updateTarget(params);
      set({
        targets: get().targets.map((t) => (t.id === updated.id ? updated : t)),
      });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  deleteTarget: async (id) => {
    try {
      await api.deleteTarget(id);
      set({
        targets: get().targets.filter((t) => t.id !== id),
        evaluations: get().evaluations.filter((e) => e.targetId !== id),
      });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  clear: () => set({ targets: [], evaluations: [], error: null }),
}));

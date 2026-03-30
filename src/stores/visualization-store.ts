import { create } from "zustand";
import * as api from "@/lib/api";
import type {
  Visualization,
  CreateVisualizationParams,
  UpdateVisualizationParams,
  ListVisualizationsParams,
} from "@openhelm/shared";

interface VisualizationState {
  visualizations: Visualization[];
  loading: boolean;
  error: string | null;

  fetchVisualizations: (params: ListVisualizationsParams) => Promise<void>;
  fetchAllVisualizations: () => Promise<void>;
  createVisualization: (params: CreateVisualizationParams) => Promise<Visualization | null>;
  updateVisualization: (params: UpdateVisualizationParams) => Promise<void>;
  deleteVisualization: (id: string) => Promise<void>;
  acceptVisualization: (id: string) => Promise<void>;
  dismissVisualization: (id: string) => Promise<void>;

  // Store update methods (from IPC events)
  addToStore: (viz: Visualization) => void;
  updateInStore: (viz: Visualization) => void;
  removeFromStore: (id: string) => void;
  clear: () => void;
}

export const useVisualizationStore = create<VisualizationState>((set, get) => ({
  visualizations: [],
  loading: false,
  error: null,

  fetchVisualizations: async (params) => {
    set({ loading: true, error: null });
    try {
      const visualizations = await api.listVisualizations(params);
      set({ visualizations, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  fetchAllVisualizations: async () => {
    set({ loading: true, error: null });
    try {
      const visualizations = await api.listAllVisualizations();
      set({ visualizations, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  createVisualization: async (params) => {
    try {
      const viz = await api.createVisualization(params);
      set({ visualizations: [viz, ...get().visualizations] });
      return viz;
    } catch (err) {
      console.error("[visualization-store] createVisualization error:", err);
      set({ error: String(err) });
      return null;
    }
  },

  updateVisualization: async (params) => {
    try {
      const updated = await api.updateVisualization(params);
      set({
        visualizations: get().visualizations.map((v) =>
          v.id === updated.id ? updated : v
        ),
      });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  deleteVisualization: async (id) => {
    try {
      await api.deleteVisualization(id);
      set({ visualizations: get().visualizations.filter((v) => v.id !== id) });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  acceptVisualization: async (id) => {
    try {
      const updated = await api.acceptVisualization(id);
      set({
        visualizations: get().visualizations.map((v) =>
          v.id === updated.id ? updated : v
        ),
      });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  dismissVisualization: async (id) => {
    try {
      const updated = await api.dismissVisualization(id);
      set({
        visualizations: get().visualizations.map((v) =>
          v.id === updated.id ? updated : v
        ),
      });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  addToStore: (viz) => {
    const exists = get().visualizations.some((v) => v.id === viz.id);
    if (!exists) set({ visualizations: [viz, ...get().visualizations] });
  },

  updateInStore: (viz) => {
    set({
      visualizations: get().visualizations.map((v) =>
        v.id === viz.id ? viz : v
      ),
    });
  },

  removeFromStore: (id) => {
    set({ visualizations: get().visualizations.filter((v) => v.id !== id) });
  },

  clear: () => set({ visualizations: [], error: null }),
}));

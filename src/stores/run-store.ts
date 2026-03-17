import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { Run, RunStatus } from "@openorchestra/shared";
import * as api from "@/lib/api";
import { friendlyError } from "@/lib/utils";

interface RunState {
  runs: Run[];
  loading: boolean;
  error: string | null;

  fetchRuns: (projectId: string | null) => Promise<void>;
  fetchRunsByJob: (jobId: string) => Promise<Run[]>;
  triggerRun: (jobId: string) => Promise<Run>;
  triggerDeferredRun: (jobId: string, fireAt: string) => Promise<Run>;
  cancelRun: (runId: string) => Promise<void>;
  deleteRun: (runId: string) => Promise<void>;
  clearRunsByJob: (jobId: string) => Promise<void>;
  updateRunStatus: (runId: string, status: RunStatus) => void;
  updateRunInStore: (run: Partial<Run> & { id: string }) => void;
}

export const useRunStore = create<RunState>((set) => ({
  runs: [],
  loading: false,
  error: null,

  fetchRuns: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const runs = await api.listRuns(projectId ? { projectId, limit: 100 } : { limit: 100 });
      set({ runs, loading: false });
    } catch (err) {
      set({
        error: friendlyError(err, "Failed to load runs"),
        loading: false,
      });
    }
  },

  fetchRunsByJob: async (jobId) => {
    return api.listRuns({ jobId, limit: 20 });
  },

  triggerRun: async (jobId) => {
    try {
      const run = await api.triggerRun({ jobId });
      set((s) => ({ runs: [run, ...s.runs] }));
      return run;
    } catch (err) {
      set({ error: friendlyError(err, "Failed to trigger run") });
      throw err;
    }
  },

  triggerDeferredRun: async (jobId, fireAt) => {
    try {
      const run = await api.triggerRun({ jobId, fireAt });
      set((s) => ({ runs: [run, ...s.runs] }));
      return run;
    } catch (err) {
      set({ error: friendlyError(err, "Failed to schedule deferred run") });
      throw err;
    }
  },

  cancelRun: async (runId) => {
    try {
      await api.cancelRun({ runId });
      set((s) => ({
        runs: s.runs.map((r) =>
          r.id === runId ? { ...r, status: "cancelled" as RunStatus } : r,
        ),
      }));
    } catch (err) {
      set({ error: friendlyError(err, "Failed to cancel run") });
      throw err;
    }
  },

  deleteRun: async (runId) => {
    try {
      await api.deleteRun(runId);
      set((s) => ({ runs: s.runs.filter((r) => r.id !== runId) }));
    } catch (err) {
      set({ error: friendlyError(err, "Failed to delete run") });
      throw err;
    }
  },

  clearRunsByJob: async (jobId) => {
    try {
      await api.clearRunsByJob({ jobId });
      set((s) => ({ runs: s.runs.filter((r) => r.jobId !== jobId) }));
    } catch (err) {
      set({ error: friendlyError(err, "Failed to clear run history") });
      throw err;
    }
  },

  updateRunStatus: (runId, status) => {
    set((s) => ({
      runs: s.runs.map((r) => (r.id === runId ? { ...r, status } : r)),
    }));
  },

  updateRunInStore: (partial) => {
    set((s) => ({
      runs: s.runs.map((r) =>
        r.id === partial.id ? { ...r, ...partial } : r,
      ),
    }));
  },
}));

/* ── Granular selector hooks ── */
export const useRuns = () => useRunStore((s) => s.runs);
export const useRunsLoading = () => useRunStore((s) => s.loading);
export const useRunActions = () =>
  useRunStore(
    useShallow((s) => ({
      fetchRuns: s.fetchRuns,
      fetchRunsByJob: s.fetchRunsByJob,
      triggerRun: s.triggerRun,
      triggerDeferredRun: s.triggerDeferredRun,
      cancelRun: s.cancelRun,
      deleteRun: s.deleteRun,
      clearRunsByJob: s.clearRunsByJob,
      updateRunStatus: s.updateRunStatus,
      updateRunInStore: s.updateRunInStore,
    })),
  );

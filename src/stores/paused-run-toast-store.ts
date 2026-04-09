import { create } from "zustand";

export interface PausedRunToast {
  runId: string;
  jobId: string;
}

interface PausedRunToastState {
  pending: PausedRunToast | null;
  showToast: (runId: string, jobId: string) => void;
  dismissToast: () => void;
}

export const usePausedRunToastStore = create<PausedRunToastState>((set) => ({
  pending: null,
  showToast: (runId, jobId) => set({ pending: { runId, jobId } }),
  dismissToast: () => set({ pending: null }),
}));

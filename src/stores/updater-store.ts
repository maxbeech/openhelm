import { create } from "zustand";

interface UpdaterState {
  shouldCheckUpdates: boolean;
  setShouldCheckUpdates: (v: boolean) => void;
}

export const useUpdaterStore = create<UpdaterState>((set) => ({
  shouldCheckUpdates: false,
  setShouldCheckUpdates: (v) => set({ shouldCheckUpdates: v }),
}));

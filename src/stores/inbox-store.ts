import { create } from "zustand";
import * as api from "@/lib/api";
import type { InboxItem, InboxResolveAction } from "@openorchestra/shared";

interface InboxState {
  items: InboxItem[];
  openCount: number;
  loading: boolean;
  error: string | null;

  fetchItems: () => Promise<void>;
  fetchOpenCount: (projectId?: string) => Promise<void>;
  resolveItem: (id: string, action: InboxResolveAction, guidance?: string) => Promise<void>;
  addItemToStore: (item: InboxItem) => void;
  updateItemInStore: (item: InboxItem) => void;
}

export const useInboxStore = create<InboxState>((set, get) => ({
  items: [],
  openCount: 0,
  loading: false,
  error: null,

  fetchItems: async () => {
    set({ loading: true, error: null });
    try {
      const items = await api.listInboxItems({ status: "open" });
      set({ items, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  fetchOpenCount: async (projectId?: string) => {
    try {
      const { count } = await api.countInboxItems(projectId);
      set({ openCount: count });
    } catch {
      // Silently fail — badge is non-critical
    }
  },

  resolveItem: async (id, action, guidance) => {
    try {
      await api.resolveInboxItem({ id, action, guidance });
      // Remove from local items
      set((s) => ({
        items: s.items.filter((item) => item.id !== id),
        openCount: Math.max(0, s.openCount - 1),
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  addItemToStore: (item) => {
    set((s) => ({
      items: [item, ...s.items],
      openCount: s.openCount + 1,
    }));
  },

  updateItemInStore: (item) => {
    set((s) => ({
      items: s.items.map((i) => (i.id === item.id ? item : i)),
      openCount: item.status !== "open"
        ? Math.max(0, s.openCount - 1)
        : s.openCount,
    }));
  },
}));

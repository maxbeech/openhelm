import { create } from "zustand";
import * as api from "@/lib/api";
import type { InboxItem, InboxResolveAction } from "@openhelm/shared";

interface InboxState {
  items: InboxItem[];
  openCount: number;
  loading: boolean;
  error: string | null;

  fetchItems: (projectId?: string) => Promise<void>;
  fetchOpenCount: (projectId?: string) => Promise<void>;
  resolveItem: (id: string, action: InboxResolveAction, guidance?: string) => Promise<void>;
  dismissAll: () => Promise<void>;
  dismissAllForJob: (jobId: string) => Promise<void>;
  addItemToStore: (item: InboxItem) => void;
  updateItemInStore: (item: InboxItem) => void;
}

export const useInboxStore = create<InboxState>((set, get) => ({
  items: [],
  openCount: 0,
  loading: false,
  error: null,

  fetchItems: async (projectId?: string) => {
    set({ loading: true, error: null });
    try {
      const items = await api.listInboxItems({
        status: "open",
        ...(projectId && { projectId }),
      });
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

  dismissAll: async () => {
    const { items } = get();
    await Promise.allSettled(
      items.map((item) => api.resolveInboxItem({ id: item.id, action: "dismiss" })),
    );
    set({ items: [], openCount: 0 });
  },

  dismissAllForJob: async (jobId: string) => {
    const { items } = get();
    const jobItems = items.filter((i) => i.jobId === jobId);
    await Promise.allSettled(
      jobItems.map((item) => api.resolveInboxItem({ id: item.id, action: "dismiss" })),
    );
    set((s) => ({
      items: s.items.filter((i) => i.jobId !== jobId),
      openCount: Math.max(0, s.openCount - jobItems.length),
    }));
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

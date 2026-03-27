import { create } from "zustand";
import * as api from "@/lib/api";
import type { DashboardItem, DashboardResolveAction } from "@openhelm/shared";

interface DashboardState {
  items: DashboardItem[];
  openCount: number;
  loading: boolean;
  error: string | null;

  fetchItems: (projectId?: string) => Promise<void>;
  fetchOpenCount: (projectId?: string) => Promise<void>;
  resolveItem: (id: string, action: DashboardResolveAction, guidance?: string) => Promise<void>;
  dismissAll: () => Promise<void>;
  dismissAllForJob: (jobId: string) => Promise<void>;
  addItemToStore: (item: DashboardItem) => void;
  updateItemInStore: (item: DashboardItem) => void;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  items: [],
  openCount: 0,
  loading: false,
  error: null,

  fetchItems: async (projectId?: string) => {
    set({ loading: true, error: null });
    try {
      const items = await api.listDashboardItems({
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
      const { count } = await api.countDashboardItems(projectId);
      set({ openCount: count });
    } catch {
      // Silently fail — badge is non-critical
    }
  },

  resolveItem: async (id, action, guidance) => {
    try {
      await api.resolveDashboardItem({ id, action, guidance });
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
    const results = await Promise.allSettled(
      items.map((item) => api.resolveDashboardItem({ id: item.id, action: "dismiss" })),
    );
    // Only remove items whose dismiss call succeeded; leave failures in store.
    const dismissedIds = new Set(
      items.filter((_, i) => results[i].status === "fulfilled").map((item) => item.id),
    );
    set((s) => ({
      items: s.items.filter((item) => !dismissedIds.has(item.id)),
      openCount: Math.max(0, s.openCount - dismissedIds.size),
    }));
  },

  dismissAllForJob: async (jobId: string) => {
    const { items } = get();
    const jobItems = items.filter((i) => i.jobId === jobId);
    const results = await Promise.allSettled(
      jobItems.map((item) => api.resolveDashboardItem({ id: item.id, action: "dismiss" })),
    );
    // Only remove items whose dismiss call succeeded; leave failures in store.
    const dismissedIds = new Set(
      jobItems.filter((_, i) => results[i].status === "fulfilled").map((item) => item.id),
    );
    set((s) => ({
      items: s.items.filter((item) => !dismissedIds.has(item.id)),
      openCount: Math.max(0, s.openCount - dismissedIds.size),
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

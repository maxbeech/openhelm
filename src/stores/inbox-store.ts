import { create } from "zustand";
import * as api from "@/lib/api";
import type { InboxEvent } from "@openhelm/shared";

interface InboxState {
  // Event data
  events: InboxEvent[];
  futureEvents: InboxEvent[];
  loading: boolean;
  error: string | null;

  // Pagination
  hasMorePast: boolean;
  loadingPast: boolean;

  // Tier / zoom
  tierThreshold: number;
  tierBoundaries: number[];
  tierLabels: string[];

  // Chat
  replyContext: { eventId: string; preview: string } | null;
  sending: boolean;

  // Unread
  unreadCount: number;

  // Actions
  fetchInitial: (projectId: string | null) => Promise<void>;
  fetchOlderEvents: (projectId: string | null) => Promise<void>;
  fetchFutureEvents: (projectId: string | null) => Promise<void>;
  setTierThreshold: (value: number) => void;
  setReplyContext: (ctx: { eventId: string; preview: string } | null) => void;
  sendMessage: (projectId: string | null, content: string) => Promise<void>;
  addEventToStore: (event: InboxEvent) => void;
  updateEventInStore: (event: InboxEvent) => void;
  fetchUnreadCount: (projectId: string | null) => Promise<void>;
  fetchTierBoundaries: (projectId: string | null) => Promise<void>;
}

/** Binary insert into events array sorted by eventAt ascending */
function insertSorted(events: InboxEvent[], ev: InboxEvent): InboxEvent[] {
  // Don't add duplicates
  if (events.some((e) => e.id === ev.id)) return events;
  const newEvents = [...events];
  let lo = 0, hi = newEvents.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (newEvents[mid].eventAt < ev.eventAt) lo = mid + 1;
    else hi = mid;
  }
  newEvents.splice(lo, 0, ev);
  return newEvents;
}

export const useInboxStore = create<InboxState>((set, get) => ({
  events: [],
  futureEvents: [],
  loading: false,
  error: null,
  hasMorePast: true,
  loadingPast: false,
  tierThreshold: 0,
  tierBoundaries: [],
  tierLabels: ["All Events"],
  replyContext: null,
  sending: false,
  unreadCount: 0,

  fetchInitial: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const now = new Date().toISOString();

      const [events, futureEvents] = await Promise.all([
        // No lower bound — fetch the 100 most recent events before now.
        // Infinite scroll loads older events on demand.
        api.listInboxEvents({
          projectId: projectId ?? undefined,
          before: now,
          limit: 100,
        }),
        // Always fetch future runs across all projects — future scheduled runs
        // are cross-project system-level events, so ignore the project filter here.
        api.listFutureInboxEvents({ limit: 20 }),
      ]);

      set({
        events,
        futureEvents,
        loading: false,
        hasMorePast: events.length >= 100,
      });

      // Fetch tier boundaries for the loaded range
      get().fetchTierBoundaries(projectId);
      get().fetchUnreadCount(projectId);
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  fetchOlderEvents: async (projectId) => {
    const { events, loadingPast, hasMorePast } = get();
    if (loadingPast || !hasMorePast) return;

    set({ loadingPast: true });
    try {
      const oldest = events[0]?.eventAt;
      const older = await api.listInboxEvents({
        projectId: projectId ?? undefined,
        before: oldest,
        limit: 50,
      });
      set((s) => ({
        events: [...older, ...s.events],
        loadingPast: false,
        hasMorePast: older.length >= 50,
      }));
    } catch {
      set({ loadingPast: false });
    }
  },

  fetchFutureEvents: async (_projectId) => {
    try {
      // Always cross-project — future scheduled runs are system-level
      const futureEvents = await api.listFutureInboxEvents({ limit: 20 });
      set({ futureEvents });
    } catch { /* non-fatal */ }
  },

  setTierThreshold: (value) => set({ tierThreshold: value }),

  setReplyContext: (ctx) => set({ replyContext: ctx }),

  sendMessage: async (projectId, content) => {
    const { replyContext } = get();
    set({ sending: true });
    try {
      await api.sendInboxMessage({
        projectId,
        content,
        replyToEventId: replyContext?.eventId,
      });
      set({ replyContext: null, sending: false });
    } catch {
      set({ sending: false });
    }
  },

  addEventToStore: (event) => {
    set((s) => ({ events: insertSorted(s.events, event) }));
  },

  updateEventInStore: (event) => {
    set((s) => ({
      events: s.events.map((e) => (e.id === event.id ? event : e)),
    }));
  },

  fetchUnreadCount: async (projectId) => {
    try {
      const { count } = await api.countInboxEvents({
        projectId: projectId ?? undefined,
        status: "active",
      });
      set({ unreadCount: count });
    } catch { /* non-fatal */ }
  },

  fetchTierBoundaries: async (projectId) => {
    try {
      const { events } = get();
      const now = new Date().toISOString();
      // Use the oldest loaded event as the lower bound, or fall back to 30 days
      const from = events[0]?.eventAt
        ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const result = await api.getInboxTierBoundaries({
        projectId: projectId ?? undefined,
        from,
        to: now,
      });
      set({
        tierBoundaries: result.boundaries,
        tierLabels: result.labels,
        tierThreshold: result.boundaries[0] ?? 0,
      });
    } catch { /* non-fatal — show all events */ }
  },
}));

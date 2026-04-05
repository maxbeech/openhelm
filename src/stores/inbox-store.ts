import { create } from "zustand";
import * as api from "@/lib/api";
import type { InboxEvent } from "@openhelm/shared";

const LAST_READ_KEY = "inbox-last-read-at";

function getStoredLastReadAt(): string | null {
  try {
    return typeof localStorage !== "undefined"
      ? localStorage.getItem(LAST_READ_KEY)
      : null;
  } catch {
    return null;
  }
}

function saveLastReadAt(at: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(LAST_READ_KEY, at);
  } catch { /* non-fatal */ }
}

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

  // Unread tracking (frontend-only, persisted to localStorage)
  unreadCount: number;
  lastReadAt: string | null;
  topTierMinImportance: number;

  // Actions
  fetchInitial: (projectId: string | null) => Promise<void>;
  fetchOlderEvents: (projectId: string | null) => Promise<void>;
  fetchFutureEvents: (projectId: string | null) => Promise<void>;
  setTierThreshold: (value: number) => void;
  setReplyContext: (ctx: { eventId: string; preview: string } | null) => void;
  sendMessage: (projectId: string | null, content: string) => Promise<void>;
  addEventToStore: (event: InboxEvent) => void;
  updateEventInStore: (event: InboxEvent) => void;
  markReadUpTo: (at: string) => void;
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

function computeUnreadCount(
  events: InboxEvent[],
  lastReadAt: string | null,
  topTierMinImportance: number,
): number {
  if (!lastReadAt) return 0;
  return events.filter(
    (e) => e.importance >= topTierMinImportance && e.eventAt > lastReadAt,
  ).length;
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
  lastReadAt: getStoredLastReadAt(),
  topTierMinImportance: 0,

  fetchInitial: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const now = new Date().toISOString();

      const [events, futureEvents] = await Promise.all([
        api.listInboxEvents({
          projectId: projectId ?? undefined,
          before: now,
          limit: 100,
        }),
        api.listFutureInboxEvents({ limit: 20 }),
      ]);

      // On first ever visit, seed lastReadAt so existing events aren't shown as unread
      let { lastReadAt, topTierMinImportance } = get();
      if (!lastReadAt) {
        lastReadAt = now;
        saveLastReadAt(now);
      }

      set({
        events,
        futureEvents,
        loading: false,
        hasMorePast: events.length >= 100,
        lastReadAt,
        unreadCount: computeUnreadCount(events, lastReadAt, topTierMinImportance),
      });

      get().fetchTierBoundaries(projectId);
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
    set((s) => {
      const events = insertSorted(s.events, event);
      return {
        events,
        unreadCount: computeUnreadCount(events, s.lastReadAt, s.topTierMinImportance),
      };
    });
  },

  updateEventInStore: (event) => {
    set((s) => ({
      events: s.events.map((e) => (e.id === event.id ? event : e)),
    }));
  },

  markReadUpTo: (at: string) => {
    const { lastReadAt, events, topTierMinImportance } = get();
    if (lastReadAt && at <= lastReadAt) return;
    saveLastReadAt(at);
    set({
      lastReadAt: at,
      unreadCount: computeUnreadCount(events, at, topTierMinImportance),
    });
  },

  fetchTierBoundaries: async (projectId) => {
    try {
      const { events } = get();
      const now = new Date().toISOString();
      const from = events[0]?.eventAt
        ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const result = await api.getInboxTierBoundaries({
        projectId: projectId ?? undefined,
        from,
        to: now,
      });
      const topTierMinImportance = result.boundaries.length > 0 ? result.boundaries[0] : 0;
      const { lastReadAt } = get();
      set({
        tierBoundaries: result.boundaries,
        tierLabels: result.labels,
        tierThreshold: 0,
        topTierMinImportance,
        unreadCount: computeUnreadCount(events, lastReadAt, topTierMinImportance),
      });
    } catch { /* non-fatal — show all events */ }
  },
}));

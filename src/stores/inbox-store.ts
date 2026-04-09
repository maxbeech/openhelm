import { create } from "zustand";
import * as api from "@/lib/api";
import type { InboxEvent } from "@openhelm/shared";

const LAST_READ_KEY = "inbox-last-read-at";
const ZOOM_KEY = "inbox-tier-threshold";

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

function getStoredTierThreshold(): number {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(ZOOM_KEY) : null;
    return v != null ? Number(v) : 0;
  } catch { return 0; }
}

function saveStoredTierThreshold(v: number): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(ZOOM_KEY, String(v));
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

  // Optimistic send tracking: temp event ID pending replacement by real event
  pendingTempUserMessageId: string | null;

  // Scroll signal: incremented to tell the timeline to scroll to Now
  scrollToNowToken: number;

  // Inbox conversation ID — used by the timeline to read streaming state from chat store
  inboxConversationId: string | null;
  // Whether the AI is currently processing a reply (loading state)
  inboxAiResponding: boolean;

  // Unread tracking (frontend-only, persisted to localStorage)
  unreadCount: number;
  lastReadAt: string | null;
  topTierMinImportance: number;

  // Scroll restoration (set by nav back/forward, consumed by InboxTimeline on first render)
  pendingScrollTop: number | null;

  // Actions
  setPendingScrollTop: (v: number | null) => void;
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
  tierThreshold: getStoredTierThreshold(),
  tierBoundaries: [],
  tierLabels: ["All Events"],
  replyContext: null,
  sending: false,
  pendingTempUserMessageId: null,
  scrollToNowToken: 0,
  inboxConversationId: null,
  inboxAiResponding: false,
  unreadCount: 0,
  lastReadAt: getStoredLastReadAt(),
  topTierMinImportance: 0,
  pendingScrollTop: null,

  setPendingScrollTop: (v) => set({ pendingScrollTop: v }),

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

  setTierThreshold: (value) => {
    saveStoredTierThreshold(value);
    set({ tierThreshold: value });
  },

  setReplyContext: (ctx) => set({ replyContext: ctx }),

  sendMessage: async (projectId, content) => {
    const { replyContext } = get();
    const now = new Date().toISOString();
    const tempId = `temp-${Date.now()}`;

    // Optimistic update: add user message immediately so it appears below Now
    const tempEvent: InboxEvent = {
      id: tempId,
      projectId,
      category: "chat",
      eventType: "chat.user_message",
      importance: 10,
      title: content.length > 80 ? content.slice(0, 80) + "…" : content,
      body: content,
      sourceId: null,
      sourceType: "message",
      metadata: {},
      conversationId: null,
      replyToEventId: replyContext?.eventId ?? null,
      status: "active",
      resolvedAt: null,
      eventAt: now,
      createdAt: now,
    };

    set((s) => ({
      sending: true,
      inboxAiResponding: true,
      pendingTempUserMessageId: tempId,
      events: insertSorted(s.events, tempEvent),
      scrollToNowToken: s.scrollToNowToken + 1,
    }));

    try {
      const result = await api.sendInboxMessage({
        projectId,
        content,
        replyToEventId: replyContext?.eventId,
      });
      set({ replyContext: null, sending: false, inboxConversationId: result.conversationId });
    } catch {
      // Roll back temp event on failure
      set((s) => ({
        sending: false,
        inboxAiResponding: false,
        pendingTempUserMessageId: null,
        events: s.events.filter((e) => e.id !== tempId),
      }));
    }
  },

  addEventToStore: (event) => {
    set((s) => {
      // When the real user message arrives from the agent, replace the optimistic temp event
      const tempId = s.pendingTempUserMessageId;
      const removeTempEvent =
        tempId !== null && event.eventType === "chat.user_message";
      const base = removeTempEvent
        ? s.events.filter((e) => e.id !== tempId)
        : s.events;
      const events = insertSorted(base, event);
      const clearAiResponding = event.eventType === "chat.assistant_message";
      return {
        events,
        pendingTempUserMessageId: removeTempEvent ? null : tempId,
        inboxAiResponding: clearAiResponding ? false : s.inboxAiResponding,
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
        topTierMinImportance,
        unreadCount: computeUnreadCount(events, lastReadAt, topTierMinImportance),
      });
    } catch { /* non-fatal — show all events */ }
  },
}));

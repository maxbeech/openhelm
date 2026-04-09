import { useRef, useMemo, useCallback, useLayoutEffect, useState, useEffect, Fragment } from "react";
import { flushSync } from "react-dom";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, ArrowDown, ArrowUp } from "lucide-react";
import { useInboxStore } from "@/stores/inbox-store";
import { useChatStore } from "@/stores/chat-store";
import { usePinchZoom } from "@/hooks/use-pinch-zoom";
import { AnimatedHelmLogo } from "@/components/chat/animated-helm-logo";
import { InboxNowMarker } from "./inbox-now-marker";
import { InboxUnreadMarker } from "./inbox-unread-marker";
import { InboxTimeHeader } from "./inbox-time-header";
import { InboxEvent } from "./inbox-event";
import { InboxActiveRunRow } from "./inbox-active-run-row";
import { useActiveRuns } from "@/hooks/use-active-runs";
import type { InboxEvent as InboxEventType, InboxCategory } from "@openhelm/shared";

interface Props {
  projectId: string | null;
  loading: boolean;
  searchQuery?: string;
  filterCategory?: InboxCategory | null;
}

function groupEventsByDate(events: InboxEventType[]): Map<string, InboxEventType[]> {
  const groups = new Map<string, InboxEventType[]>();
  for (const event of events) {
    const dateKey = event.eventAt.slice(0, 10); // YYYY-MM-DD
    const existing = groups.get(dateKey) ?? [];
    existing.push(event);
    groups.set(dateKey, existing);
  }
  return groups;
}

export function InboxTimeline({ projectId, loading, searchQuery, filterCategory }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nowMarkerRef = useRef<HTMLDivElement>(null);
  const unreadMarkerRef = useRef<HTMLDivElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const [nowVisible, setNowVisible] = useState(true);
  const [nowAboveViewport, setNowAboveViewport] = useState(false);
  const prevScrollHeight = useRef(0);
  const hasScrolledToUnread = useRef(false);

  const {
    events,
    futureEvents,
    tierThreshold,
    tierBoundaries,
    hasMorePast,
    loadingPast,
    fetchOlderEvents,
    setTierThreshold,
    lastReadAt,
    topTierMinImportance,
    markReadUpTo,
    scrollToNowToken,
    inboxConversationId,
    inboxAiResponding,
  } = useInboxStore();

  // Read streaming state for the inbox conversation from the chat store
  const inboxStreamingText = useChatStore(
    (s) => (inboxConversationId ? (s.conversationStates[inboxConversationId]?.streamingText ?? "") : ""),
  );
  const inboxStatusText = useChatStore(
    (s) => (inboxConversationId ? (s.conversationStates[inboxConversationId]?.statusText ?? null) : null),
  );
  const showInboxLoader = inboxAiResponding && !inboxStreamingText;
  const showInboxStreaming = inboxStreamingText.length > 0;

  const { activeRuns } = useActiveRuns(projectId);

  // Reset initial scroll flag when project changes so we re-scroll on next load
  useEffect(() => {
    hasScrolledToUnread.current = false;
  }, [projectId]);

  // Pinch-to-zoom: continuous smooth zoom between tier stops.
  const stopsRef = useRef<number[]>([]);
  stopsRef.current = useMemo(() => {
    const s = [...tierBoundaries, 0].sort((a, b) => b - a);
    return [...new Set(s)];
  }, [tierBoundaries]);

  const zoomAccRef = useRef(0);

  // Snapshot of what sits at viewport center immediately before a zoom.
  // Records the TIME (ms) of the nearest event and its pixel offset from the
  // container's visible top edge, so we can pin that same time back to the
  // same visual position after the DOM updates — even if the exact event
  // gets filtered out by the new threshold.
  type Anchor = { anchorTimeMs: number; viewportOffset: number };

  const captureAnchor = useCallback((): Anchor | null => {
    const container = containerRef.current;
    if (!container) return null;
    const containerRect = container.getBoundingClientRect();
    const centerY = containerRect.top + containerRect.height / 2;
    const eventEls = container.querySelectorAll<HTMLElement>("[data-event-at]");
    let bestAt: string | null = null;
    let bestOffset = 0;
    let bestDist = Infinity;
    eventEls.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const elCenter = rect.top + rect.height / 2;
      const dist = Math.abs(elCenter - centerY);
      if (dist < bestDist) {
        bestDist = dist;
        bestAt = el.dataset.eventAt ?? null;
        bestOffset = rect.top - containerRect.top;
      }
    });
    if (!bestAt) return null;
    return {
      anchorTimeMs: new Date(bestAt).getTime(),
      viewportOffset: bestOffset,
    };
  }, []);

  const restoreAnchor = useCallback((anchor: Anchor) => {
    const container = containerRef.current;
    if (!container) return;
    const eventEls = container.querySelectorAll<HTMLElement>("[data-event-at]");
    let bestEl: HTMLElement | null = null;
    let bestDist = Infinity;
    eventEls.forEach((el) => {
      const at = el.dataset.eventAt;
      if (!at) return;
      const diff = Math.abs(new Date(at).getTime() - anchor.anchorTimeMs);
      if (diff < bestDist) {
        bestDist = diff;
        bestEl = el;
      }
    });
    if (!bestEl) return;
    const containerRect = container.getBoundingClientRect();
    const elRect = (bestEl as HTMLElement).getBoundingClientRect();
    const currentOffset = elRect.top - containerRect.top;
    const delta = currentOffset - anchor.viewportOffset;
    if (delta !== 0) container.scrollTop += delta;
  }, []);

  const handleZoom = useCallback(
    (deltaY: number) => {
      const stops = stopsRef.current;
      const maxStop = stops[0] ?? 100;
      const minStop = 0;

      zoomAccRef.current += deltaY * 0.5;
      const SNAP_THRESHOLD = 12;

      if (Math.abs(zoomAccRef.current) < SNAP_THRESHOLD) return;

      const direction = zoomAccRef.current > 0 ? 1 : -1;
      zoomAccRef.current = 0;

      // Capture BEFORE state change — DOM is still in old layout here.
      const anchor = captureAnchor();

      // Compute the next threshold value.
      let nextThreshold: number;
      if (stops.length > 1) {
        let idx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < stops.length; i++) {
          const d = Math.abs(tierThreshold - stops[i]);
          if (d < bestDist) { bestDist = d; idx = i; }
        }
        const nextIdx = direction > 0
          ? Math.max(0, idx - 1)
          : Math.min(stops.length - 1, idx + 1);
        nextThreshold = stops[nextIdx];
      } else {
        nextThreshold = tierThreshold >= maxStop ? minStop : maxStop;
      }

      if (nextThreshold === tierThreshold) return;

      // flushSync forces the re-render + DOM commit to complete synchronously
      // inside the wheel handler. After this returns, the DOM reflects the new
      // threshold and we can measure & correct scrollTop immediately — no
      // useLayoutEffect timing games, no dependency on Framer Motion's unmount
      // schedule, no visible jump.
      flushSync(() => {
        setTierThreshold(nextThreshold);
      });

      if (anchor) restoreAnchor(anchor);
    },
    [tierThreshold, setTierThreshold, captureAnchor, restoreAnchor],
  );
  usePinchZoom(containerRef, handleZoom);

  // Filter events by tier threshold + search + category.
  // Chat events (user messages + AI replies) always pass the importance filter
  // so they remain visible regardless of the zoom level.
  const filterEvent = useCallback(
    (e: InboxEventType) => {
      if (filterCategory && e.category !== filterCategory) return false;
      if (searchQuery?.trim()) {
        const q = searchQuery.toLowerCase();
        if (
          !e.title.toLowerCase().includes(q) &&
          !(e.body && e.body.toLowerCase().includes(q))
        )
          return false;
      }
      if (e.category !== "chat" && e.importance < tierThreshold) return false;
      return true;
    },
    [tierThreshold, filterCategory, searchQuery],
  );

  const visibleEvents = useMemo(
    () => events.filter(filterEvent),
    [events, filterEvent],
  );

  const visibleFutureEvents = useMemo(
    () => futureEvents.filter(filterEvent),
    [futureEvents, filterEvent],
  );

  // ID of the first unread event in the visible list (for placing the unread marker)
  const firstUnreadEventId = useMemo(() => {
    if (!lastReadAt) return null;
    const first = visibleEvents.find(
      (e) => e.importance >= topTierMinImportance && e.eventAt > lastReadAt,
    );
    return first?.id ?? null;
  }, [visibleEvents, lastReadAt, topTierMinImportance]);

  // Group visible events by date
  const dateGroups = useMemo(() => groupEventsByDate(visibleEvents), [visibleEvents]);
  const futureDateGroups = useMemo(() => groupEventsByDate(visibleFutureEvents), [visibleFutureEvents]);

  // On initial load, restore a pending nav scroll position (back/forward) or
  // scroll to the unread marker (if any) otherwise to Now.
  // Also depends on `events` so we wait until events are populated — avoids
  // the race where loading=false but events=[] on first render.
  useEffect(() => {
    if (loading || events.length === 0 || hasScrolledToUnread.current) return;
    hasScrolledToUnread.current = true;

    const { pendingScrollTop, setPendingScrollTop } = useInboxStore.getState();
    if (pendingScrollTop !== null) {
      // Consumed — clear before scrolling so subsequent mounts behave normally.
      setPendingScrollTop(null);
      requestAnimationFrame(() => {
        const container = containerRef.current;
        if (container) container.scrollTop = pendingScrollTop;
      });
    } else {
      requestAnimationFrame(() => {
        if (unreadMarkerRef.current) {
          unreadMarkerRef.current.scrollIntoView({ block: "start" });
        } else {
          nowMarkerRef.current?.scrollIntoView({ block: "center" });
        }
      });
    }
  }, [loading, events]);

  // Observe Now marker visibility relative to the scroll container (not the
  // viewport). Without `root: container`, elements inside an overflow-y-auto
  // div always "intersect" the viewport regardless of inner scroll position,
  // so the observer never fires when scrolling within the container.
  useEffect(() => {
    const el = nowMarkerRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const obs = new IntersectionObserver(([entry]) => {
      setNowVisible(entry.isIntersecting);
      if (!entry.isIntersecting) {
        // rootBounds.top is the container's top edge in viewport coordinates.
        // Now is "above" (user scrolled into future) when its top is above that edge.
        const rootTop = entry.rootBounds?.top ?? 0;
        setNowAboveViewport(entry.boundingClientRect.top < rootTop);
      }
    }, { threshold: 0.1, root: container });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Infinite scroll: load older events when top sentinel is visible
  useEffect(() => {
    const el = topSentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMorePast && !loadingPast) {
          prevScrollHeight.current = containerRef.current?.scrollHeight ?? 0;
          fetchOlderEvents(projectId);
        }
      },
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMorePast, loadingPast, fetchOlderEvents, projectId]);

  // Preserve scroll position when prepending past events
  useLayoutEffect(() => {
    if (prevScrollHeight.current > 0 && containerRef.current) {
      const newHeight = containerRef.current.scrollHeight;
      const delta = newHeight - prevScrollHeight.current;
      if (delta > 0) {
        containerRef.current.scrollTop += delta;
      }
      prevScrollHeight.current = 0;
    }
  }, [events]);

  // Mark events as read as they scroll into the viewport
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onScroll = () => {
      const containerRect = container.getBoundingClientRect();
      let maxReadAt: string | null = null;

      container.querySelectorAll<HTMLElement>("[data-unread='true']").forEach((el) => {
        const rect = el.getBoundingClientRect();
        // Consider visible when top edge is above the container's bottom edge
        if (rect.top < containerRect.bottom) {
          const at = el.dataset.eventAt;
          if (at && (!maxReadAt || at > maxReadAt)) maxReadAt = at;
        }
      });

      if (maxReadAt) markReadUpTo(maxReadAt);
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [markReadUpTo]);

  const scrollToNow = useCallback(() => {
    setNowVisible(true);
    nowMarkerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // Scroll to Now whenever a message is sent (scrollToNowToken increments)
  useEffect(() => {
    if (scrollToNowToken === 0) return;
    requestAnimationFrame(() => {
      nowMarkerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setNowVisible(true);
    });
  }, [scrollToNowToken]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-y-auto px-4"
      style={{ overflowAnchor: "none" }}
    >
      {/* Top sentinel for infinite scroll */}
      <div ref={topSentinelRef} className="h-1" />

      {loadingPast && (
        <div className="flex justify-center py-3">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {visibleEvents.length === 0 && visibleFutureEvents.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">No events yet</p>
          <p className="mt-1 text-xs">Events will appear here as OpenHelm works</p>
        </div>
      )}

      {/* Past events grouped by date */}
      {Array.from(dateGroups.entries()).map(([date, dateEvents]) => (
        <div key={date}>
          <InboxTimeHeader date={date} />
          {dateEvents.map((event) => {
            const isFirstUnread = event.id === firstUnreadEventId;
            const isUnread =
              !!lastReadAt &&
              event.importance >= topTierMinImportance &&
              event.eventAt > lastReadAt;
            return (
              <Fragment key={event.id}>
                {isFirstUnread && (
                  <div ref={(el) => { if (el) unreadMarkerRef.current = el; }}>
                    <InboxUnreadMarker />
                  </div>
                )}
                <motion.div
                  data-event-id={event.id}
                  data-event-at={event.eventAt}
                  data-unread={isUnread ? "true" : undefined}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.15 } }}
                >
                  <InboxEvent event={event} isUnread={isUnread} />
                </motion.div>
              </Fragment>
            );
          })}
        </div>
      ))}

      {/* AI thinking / streaming indicator — shown just above the Now line while waiting for a response */}
      {(showInboxLoader || showInboxStreaming) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.15 } }}
          className="my-2 max-w-[85%]"
        >
          <div className="flex items-start gap-2">
            <div className="mt-1 shrink-0">
              <AnimatedHelmLogo animating={true} size={28} />
            </div>
            {showInboxStreaming ? (
              <div className="rounded-xl bg-muted px-4 py-3 text-sm text-foreground opacity-80">
                <div className="markdown-content break-words leading-relaxed [&>*:last-child]:inline">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{inboxStreamingText}</ReactMarkdown>
                  <span className="inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-foreground/50" />
                </div>
              </div>
            ) : inboxStatusText ? (
              <div className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
                {inboxStatusText}
              </div>
            ) : null}
          </div>
        </motion.div>
      )}

      {/* Now marker */}
      <div ref={nowMarkerRef}>
        <InboxNowMarker />
      </div>

      {/* Currently running / queued jobs — shown just below Now */}
      {activeRuns.length > 0 && (
        <div className="mb-1">
          {activeRuns.map(({ run, job }) => (
            <motion.div
              key={run.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.15 } }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
            >
              <InboxActiveRunRow activeRun={{ run, job }} />
            </motion.div>
          ))}
        </div>
      )}

      {/* Future events */}
      {Array.from(futureDateGroups.entries()).map(([date, dateEvents]) => (
        <div key={`future-${date}`}>
          <InboxTimeHeader date={date} />
          {dateEvents.map((event) => (
            <motion.div
              key={event.id}
              data-event-id={event.id}
              data-event-at={event.eventAt}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.15 } }}
            >
              <InboxEvent event={event} />
            </motion.div>
          ))}
        </div>
      ))}

      {/* Scroll to now button — arrow flips based on scroll direction */}
      {!nowVisible && (
        <button
          onClick={scrollToNow}
          className="fixed bottom-24 right-6 z-20 flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg transition-transform hover:scale-105"
        >
          {nowAboveViewport ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
          Now
        </button>
      )}
    </div>
  );
}

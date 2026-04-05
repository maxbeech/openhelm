import { useRef, useMemo, useCallback, useLayoutEffect, useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, ArrowDown, ArrowUp } from "lucide-react";
import { useInboxStore } from "@/stores/inbox-store";
import { usePinchZoom } from "@/hooks/use-pinch-zoom";
import { InboxNowMarker } from "./inbox-now-marker";
import { InboxTimeHeader } from "./inbox-time-header";
import { InboxEvent } from "./inbox-event";
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
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const [nowVisible, setNowVisible] = useState(true);
  const [nowAboveViewport, setNowAboveViewport] = useState(false);
  const prevScrollHeight = useRef(0);

  const {
    events,
    futureEvents,
    tierThreshold,
    tierBoundaries,
    hasMorePast,
    loadingPast,
    fetchOlderEvents,
    setTierThreshold,
  } = useInboxStore();

  // Pinch-to-zoom: continuous smooth zoom between tier stops.
  // Stops include all tier boundaries plus 0 (show everything), sorted descending.
  const stopsRef = useRef<number[]>([]);
  stopsRef.current = useMemo(() => {
    const s = [...tierBoundaries, 0].sort((a, b) => b - a);
    return [...new Set(s)];
  }, [tierBoundaries]);

  // Accumulator for smooth sub-stop zoom. Resets when we snap to a stop.
  const zoomAccRef = useRef(0);

  const handleZoom = useCallback(
    (deltaY: number) => {
      const stops = stopsRef.current;
      // Even with 0–1 stops, allow zoom between max importance and 0
      const maxStop = stops[0] ?? 100;
      const minStop = 0;

      // Accumulate delta — scale so a full trackpad pinch gesture traverses ~one tier
      zoomAccRef.current += deltaY * 0.5;
      const SNAP_THRESHOLD = 12; // accumulated delta before we jump one tier stop

      if (Math.abs(zoomAccRef.current) < SNAP_THRESHOLD) return;

      // Determine direction: positive deltaY = zoom out (raise threshold)
      const direction = zoomAccRef.current > 0 ? 1 : -1;
      zoomAccRef.current = 0; // reset accumulator

      if (stops.length > 1) {
        // Find nearest stop
        let idx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < stops.length; i++) {
          const d = Math.abs(tierThreshold - stops[i]);
          if (d < bestDist) { bestDist = d; idx = i; }
        }
        // direction > 0 = zoom out = move towards higher threshold (lower index)
        // direction < 0 = zoom in = move towards lower threshold (higher index)
        const nextIdx = direction > 0
          ? Math.max(0, idx - 1)
          : Math.min(stops.length - 1, idx + 1);
        setTierThreshold(stops[nextIdx]);
      } else {
        // Single or no tiers — toggle between max and 0
        setTierThreshold(tierThreshold >= maxStop ? minStop : maxStop);
      }
    },
    [tierThreshold, setTierThreshold],
  );
  usePinchZoom(containerRef, handleZoom);

  // Filter events by tier threshold + search + category
  const filterEvent = useCallback(
    (e: InboxEventType) => {
      if (e.importance < tierThreshold) return false;
      if (filterCategory && e.category !== filterCategory) return false;
      if (searchQuery?.trim()) {
        const q = searchQuery.toLowerCase();
        if (
          !e.title.toLowerCase().includes(q) &&
          !(e.body && e.body.toLowerCase().includes(q))
        )
          return false;
      }
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

  // Group visible events by date
  const dateGroups = useMemo(() => groupEventsByDate(visibleEvents), [visibleEvents]);
  const futureDateGroups = useMemo(() => groupEventsByDate(visibleFutureEvents), [visibleFutureEvents]);

  // Scroll to now on initial load
  useEffect(() => {
    if (!loading && nowMarkerRef.current) {
      // Small delay to ensure DOM is painted
      requestAnimationFrame(() => {
        nowMarkerRef.current?.scrollIntoView({ block: "center" });
      });
    }
  }, [loading]);

  // Observe now marker visibility and direction
  useEffect(() => {
    const el = nowMarkerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      setNowVisible(entry.isIntersecting);
      if (!entry.isIntersecting) {
        // Track whether Now marker is above viewport (user scrolled past into future)
        setNowAboveViewport(entry.boundingClientRect.top < 0);
      }
    }, { threshold: 0.1 });
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

  const scrollToNow = useCallback(() => {
    setNowVisible(true); // Immediately hide button during scroll
    nowMarkerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // Determine tier level for visual scaling (0 = top tier, 1 = second, 2+ = lower)
  const getTierLevel = useCallback(
    (importance: number): number => {
      if (tierBoundaries.length === 0) return 0;
      for (let i = 0; i < tierBoundaries.length; i++) {
        if (importance >= tierBoundaries[i]) return i;
      }
      return tierBoundaries.length;
    },
    [tierBoundaries],
  );

  // Visual properties per tier level — creates the "zoom" effect
  const tierStyles = useMemo(() => [
    { scale: 1, opacity: 1, fontSize: "1rem", py: "my-1.5" },       // top tier: full size
    { scale: 0.97, opacity: 0.88, fontSize: "0.95rem", py: "my-1" }, // 2nd tier: slightly smaller
    { scale: 0.94, opacity: 0.72, fontSize: "0.875rem", py: "my-0.5" }, // 3rd+ tier: compact
    { scale: 0.91, opacity: 0.58, fontSize: "0.8125rem", py: "my-0.5" }, // 4th tier: very compact
  ], []);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative flex-1 overflow-y-auto px-4">
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
      <AnimatePresence initial={false}>
        {Array.from(dateGroups.entries()).map(([date, dateEvents]) => (
          <div key={date}>
            <InboxTimeHeader date={date} />
            {dateEvents.map((event) => {
              const tier = getTierLevel(event.importance);
              const style = tierStyles[Math.min(tier, tierStyles.length - 1)];
              return (
                <motion.div
                  key={event.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9, height: 0 }}
                  animate={{
                    opacity: style.opacity,
                    scale: style.scale,
                    height: "auto",
                    transition: {
                      layout: { type: "spring", stiffness: 300, damping: 28 },
                      opacity: { type: "spring", stiffness: 200, damping: 25 },
                      scale: { type: "spring", stiffness: 250, damping: 26 },
                      height: { type: "spring", stiffness: 300, damping: 30 },
                    },
                  }}
                  exit={{
                    opacity: 0,
                    scale: 0.88,
                    height: 0,
                    transition: {
                      opacity: { duration: 0.15 },
                      scale: { duration: 0.18 },
                      height: { duration: 0.2, delay: 0.08 },
                    },
                  }}
                  style={{ transformOrigin: "left center" }}
                  className={style.py}
                >
                  <InboxEvent event={event} />
                </motion.div>
              );
            })}
          </div>
        ))}
      </AnimatePresence>

      {/* Now marker */}
      <div ref={nowMarkerRef}>
        <InboxNowMarker />
      </div>

      {/* Future events */}
      <AnimatePresence initial={false}>
        {Array.from(futureDateGroups.entries()).map(([date, dateEvents]) => (
          <div key={`future-${date}`}>
            <InboxTimeHeader date={date} />
            {dateEvents.map((event) => {
              const tier = getTierLevel(event.importance);
              const style = tierStyles[Math.min(tier, tierStyles.length - 1)];
              return (
                <motion.div
                  key={event.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{
                    opacity: style.opacity,
                    scale: style.scale,
                    transition: {
                      opacity: { type: "spring", stiffness: 200, damping: 25 },
                      scale: { type: "spring", stiffness: 250, damping: 26 },
                    },
                  }}
                  exit={{
                    opacity: 0,
                    scale: 0.88,
                    transition: { duration: 0.15 },
                  }}
                  style={{ transformOrigin: "left center" }}
                  className={style.py}
                >
                  <InboxEvent event={event} />
                </motion.div>
              );
            })}
          </div>
        ))}
      </AnimatePresence>

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

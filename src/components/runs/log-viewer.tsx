import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowDown, Search } from "lucide-react";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { RunLog } from "@openorchestra/shared";
import { cn } from "@/lib/utils";

/**
 * Virtual scroll constants.
 * LINE_HEIGHT must match the rendered line height (text-xs leading-5 = 20px).
 * OVERSCAN is extra lines rendered above/below the visible window to prevent
 * flicker during fast scrolling.
 */
const LINE_HEIGHT = 20;
const OVERSCAN = 20;
/** Pixel threshold for "close enough to bottom" detection */
const BOTTOM_THRESHOLD = 30;

interface LogViewerProps {
  logs: RunLog[];
  loading: boolean;
  isLive: boolean;
}

export function LogViewer({ logs, loading, isLive }: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // ---------- filtered logs ----------
  const filteredLogs = useMemo(() => {
    if (!searchQuery) return logs;
    const q = searchQuery.toLowerCase();
    return logs.filter((l) => l.text.toLowerCase().includes(q));
  }, [logs, searchQuery]);

  // ---------- virtual range calculation ----------
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN,
  );
  const endIndex = Math.min(
    filteredLogs.length,
    Math.ceil((scrollTop + containerHeight) / LINE_HEIGHT) + OVERSCAN,
  );
  const visibleLogs = filteredLogs.slice(startIndex, endIndex);
  const topPad = startIndex * LINE_HEIGHT;
  const bottomPad = Math.max(
    0,
    (filteredLogs.length - endIndex) * LINE_HEIGHT,
  );

  // ---------- scroll handler ----------
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      setScrollTop(el.scrollTop);
      const atBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
      wasAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
    },
    [],
  );

  // ---------- ResizeObserver for container height ----------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setContainerHeight(entries[0]?.contentRect.height ?? 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ---------- auto-scroll on new logs ----------
  useEffect(() => {
    if (wasAtBottomRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filteredLogs.length]);

  // ---------- scrollToBottom (for button) ----------
  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      wasAtBottomRef.current = true;
      setIsAtBottom(true);
    }
  }, []);

  // ---------- search highlight ----------
  const highlightText = (text: string, query: string) => {
    if (!query) return text;
    const q = query.toLowerCase();
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="rounded bg-primary/30 text-foreground">
          {text.slice(idx, idx + query.length)}
        </mark>
        {text.slice(idx + query.length)}
      </>
    );
  };

  return (
    <div className="relative flex h-full flex-col">
      {/* Search Bar */}
      {showSearch && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search logs..."
            className="h-7 border-none bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
            autoFocus
          />
          <button
            onClick={() => {
              setShowSearch(false);
              setSearchQuery("");
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Close
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs text-muted-foreground">
          {loading
            ? "Loading..."
            : `${filteredLogs.length} line${filteredLogs.length !== 1 ? "s" : ""}`}
        </span>
        <button
          onClick={() => setShowSearch(!showSearch)}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <Search className="size-3.5" />
        </button>
      </div>

      {/* Log Content — virtualized */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto bg-background p-2 font-mono text-xs leading-5"
      >
        {filteredLogs.length === 0 && !loading ? (
          <p className="py-8 text-center text-muted-foreground">
            {isLive ? "Waiting for output..." : "No log output"}
          </p>
        ) : (
          <>
            <div style={{ height: topPad }} />
            {visibleLogs.map((log, i) => (
              <div
                key={startIndex + i}
                style={{ height: LINE_HEIGHT }}
                className={cn(
                  "whitespace-pre-wrap break-all",
                  log.stream === "stderr" && "text-destructive/80",
                )}
              >
                {searchQuery
                  ? highlightText(log.text, searchQuery)
                  : log.text}
              </div>
            ))}
            <div style={{ height: bottomPad }} />
          </>
        )}
      </div>

      {/* Jump to Latest */}
      {!isAtBottom && isLive && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <Button
            variant="secondary"
            size="sm"
            onClick={scrollToBottom}
            className="shadow-lg"
          >
            <ArrowDown className="size-3.5" />
            Jump to latest
          </Button>
        </div>
      )}
    </div>
  );
}

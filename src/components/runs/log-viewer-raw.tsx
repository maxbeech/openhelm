import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ArrowDown } from "lucide-react";
import type { RunLog } from "@openorchestra/shared";
import { cn } from "@/lib/utils";

const LINE_HEIGHT = 20;
const OVERSCAN = 20;
const BOTTOM_THRESHOLD = 30;

interface LogViewerRawProps {
  logs: RunLog[];
  loading: boolean;
  isLive: boolean;
  searchQuery: string;
}

export function LogViewerRaw({ logs, loading, isLive, searchQuery }: LogViewerRawProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const allLines = useMemo(() => {
    const result: { text: string; stream: RunLog["stream"] }[] = [];
    for (const log of logs) {
      const parts = log.text.split("\n");
      for (const part of parts) {
        result.push({ text: part, stream: log.stream });
      }
    }
    return result;
  }, [logs]);

  const filteredLines = useMemo(() => {
    if (!searchQuery) return allLines;
    const q = searchQuery.toLowerCase();
    return allLines.filter((l) => l.text.toLowerCase().includes(q));
  }, [allLines, searchQuery]);

  const startIndex = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    filteredLines.length,
    Math.ceil((scrollTop + containerHeight) / LINE_HEIGHT) + OVERSCAN,
  );
  const visibleLogs = filteredLines.slice(startIndex, endIndex);
  const topPad = startIndex * LINE_HEIGHT;
  const bottomPad = Math.max(0, (filteredLines.length - endIndex) * LINE_HEIGHT);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setScrollTop(el.scrollTop);
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
    wasAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setContainerHeight(entries[0]?.contentRect.height ?? 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (wasAtBottomRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filteredLines.length]);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      wasAtBottomRef.current = true;
      setIsAtBottom(true);
    }
  }, []);

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
    <div className="relative flex-1">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="absolute inset-0 overflow-auto bg-background p-2 font-mono text-xs leading-5"
      >
        {filteredLines.length === 0 && !loading ? (
          <p className="py-8 text-center text-muted-foreground">
            {isLive ? "Waiting for output..." : "No log output"}
          </p>
        ) : (
          <div className="min-w-max">
            <div style={{ height: topPad }} />
            {visibleLogs.map((log, i) => (
              <div
                key={startIndex + i}
                style={{ height: LINE_HEIGHT }}
                className={cn(
                  "whitespace-pre",
                  log.stream === "stderr" && "text-destructive/80",
                )}
              >
                {searchQuery ? highlightText(log.text, searchQuery) : log.text}
              </div>
            ))}
            <div style={{ height: bottomPad }} />
          </div>
        )}
      </div>

      {!isAtBottom && isLive && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <Button variant="secondary" size="sm" onClick={scrollToBottom} className="shadow-lg">
            <ArrowDown className="size-3.5" />
            Jump to latest
          </Button>
        </div>
      )}
    </div>
  );
}

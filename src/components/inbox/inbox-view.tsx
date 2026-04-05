import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useInboxStore } from "@/stores/inbox-store";
import { PageHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { InboxTimeline } from "./inbox-timeline";
import { InboxBottomBar } from "./inbox-bottom-bar";
import type { InboxCategory } from "@openhelm/shared";

const CATEGORY_OPTIONS: Array<{ value: InboxCategory | ""; label: string }> = [
  { value: "", label: "All Categories" },
  { value: "run", label: "Runs" },
  { value: "alert", label: "Alerts" },
  { value: "action", label: "Actions" },
  { value: "chat", label: "Chat" },
  { value: "insight", label: "Insights" },
  { value: "system", label: "System" },
];

export function InboxView() {
  const { activeProjectId } = useAppStore();
  const { events, futureEvents, fetchInitial, loading } = useInboxStore();
  const [zoomToast, setZoomToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<InboxCategory | null>(null);

  useEffect(() => {
    fetchInitial(activeProjectId);
  }, [activeProjectId, fetchInitial]);

  // Reset filters when switching project
  useEffect(() => {
    setSearchQuery("");
    setFilterCategory(null);
  }, [activeProjectId]);

  const handleZoomLabelChange = useCallback((label: string) => {
    setZoomToast(label);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setZoomToast(null), 1200);
  }, []);

  const totalCount = events.length + futureEvents.length;

  return (
    <div className="relative flex h-full flex-col">
      <PageHeader
        title="Inbox"
        subtitle="Events and updates from your AI jobs."
        count={totalCount}
        filters={
          <FilterBar
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search events..."
          >
            <div className="relative">
              <select
                value={filterCategory ?? ""}
                onChange={(e) =>
                  setFilterCategory((e.target.value || null) as InboxCategory | null)
                }
                className="h-8 appearance-none rounded-md border border-input bg-background pl-3 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            </div>
          </FilterBar>
        }
      />

      <InboxTimeline
        projectId={activeProjectId}
        loading={loading}
        searchQuery={searchQuery}
        filterCategory={filterCategory}
      />
      <InboxBottomBar projectId={activeProjectId} onZoomLabelChange={handleZoomLabelChange} />

      {/* Zoom level toast */}
      {zoomToast && (
        <div className="pointer-events-none absolute bottom-20 left-1/2 z-30 -translate-x-1/2 animate-in fade-in zoom-in-95 duration-150">
          <div className="rounded-full bg-popover/90 px-3 py-1 text-xs font-medium text-popover-foreground shadow-lg backdrop-blur-sm border border-border/50">
            {zoomToast}
          </div>
        </div>
      )}
    </div>
  );
}

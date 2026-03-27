import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDashboardStore } from "@/stores/dashboard-store";
import { useJobStore } from "@/stores/job-store";
import { DashboardCard } from "./dashboard-card";
import type { DashboardItem } from "@openhelm/shared";

interface AlertGroupProps {
  jobId: string;
  items: DashboardItem[]; // Already sorted most-recent-first
}

/** A collapsible group of dashboard alerts for a single job. */
export function AlertGroup({ jobId, items }: AlertGroupProps) {
  const { jobs } = useJobStore();
  const { dismissAllForJob } = useDashboardStore();
  const [expanded, setExpanded] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const job = jobs.find((j) => j.id === jobId);
  const jobName = job?.name ?? "Unknown Job";

  // Show only the most recent alert unless expanded
  const visibleItems = expanded ? items : items.slice(0, 1);
  const hiddenCount = items.length - 1;

  const handleDismissAll = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissing(true);
    try {
      await dismissAllForJob(jobId);
    } finally {
      setDismissing(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card/50 overflow-hidden">
      {/* Group header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50 bg-card">
        <span className="text-xs font-semibold text-muted-foreground truncate flex-1">
          {jobName}
        </span>
        {items.length > 1 && (
          <Badge variant="outline" className="text-[10px] shrink-0">
            {items.length} alerts
          </Badge>
        )}
        {items.length > 1 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground shrink-0"
            disabled={dismissing}
            onClick={handleDismissAll}
          >
            Dismiss all
          </Button>
        )}
      </div>

      {/* Alert cards */}
      <div className="p-2 space-y-2">
        {visibleItems.map((item) => (
          <DashboardCard key={item.id} item={item} />
        ))}

        {/* Expand/collapse toggle */}
        {hiddenCount > 0 && (
          <button
            className="flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <>
                <ChevronUp className="size-3.5" />
                Show less
              </>
            ) : (
              <>
                <ChevronDown className="size-3.5" />
                {hiddenCount} older alert{hiddenCount !== 1 ? "s" : ""}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

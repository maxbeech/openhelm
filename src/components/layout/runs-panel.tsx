import { useMemo, useState } from "react";
import { PanelRightClose, Play } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppStore } from "@/stores/app-store";
import { useRunStore } from "@/stores/run-store";
import { useJobStore } from "@/stores/job-store";
import { RunStatusBadge } from "@/components/shared/status-badge";
import { formatRelativeTime, formatDuration, getElapsed } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "queued", label: "Queued" },
];

export function RunsPanel() {
  const {
    runsPanelOpen,
    toggleRunsPanel,
    selectedGoalId,
    selectedJobId,
    selectedRunId,
    selectRun,
  } = useAppStore();
  const { runs } = useRunStore();
  const { jobs } = useJobStore();
  const [statusFilter, setStatusFilter] = useState("all");

  // Filter runs contextually
  const contextualRuns = useMemo(() => {
    let result = runs;
    if (selectedJobId) {
      result = result.filter((r) => r.jobId === selectedJobId);
    } else if (selectedGoalId) {
      const goalJobIds = new Set(
        jobs.filter((j) => j.goalId === selectedGoalId).map((j) => j.id),
      );
      result = result.filter((r) => goalJobIds.has(r.jobId));
    }
    if (statusFilter !== "all") {
      result = result.filter((r) => r.status === statusFilter);
    }
    return result;
  }, [runs, selectedJobId, selectedGoalId, jobs, statusFilter]);

  const getJobName = (jobId: string) =>
    jobs.find((j) => j.id === jobId)?.name ?? "Unknown";

  if (!runsPanelOpen) return null;

  return (
    <div className="flex h-full w-72 flex-col border-r border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-sm font-semibold">Runs</h3>
        <button
          onClick={toggleRunsPanel}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <PanelRightClose className="size-4" />
        </button>
      </div>

      {/* Filter */}
      <div className="border-b border-border px-3 py-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Run list */}
      <div className="flex-1 overflow-auto">
        {contextualRuns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Play className="size-6 text-muted-foreground/50" />
            <p className="mt-2 text-xs text-muted-foreground">No runs yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {contextualRuns.map((run) => (
              <button
                key={run.id}
                onClick={() => selectRun(run.id, run.jobId)}
                className={cn(
                  "flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-accent/50",
                  selectedRunId === run.id && "bg-accent",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium">
                    {getJobName(run.jobId)}
                  </span>
                  <RunStatusBadge status={run.status} />
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{formatRelativeTime(run.createdAt)}</span>
                  {run.startedAt && (
                    <span>
                      {formatDuration(getElapsed(run.startedAt, run.finishedAt))}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

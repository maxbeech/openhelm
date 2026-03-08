import { useEffect, useState, useMemo, useCallback } from "react";
import { Play } from "lucide-react";
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
import { useAgentEvent } from "@/hooks/use-agent-event";
import { RunDetailPanel } from "./run-detail-panel";
import { RunStatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { TableRowSkeleton } from "@/components/shared/loading-skeleton";
import { formatRelativeTime, formatDuration, getElapsed } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RunStatus, TriggerSource } from "@openorchestra/shared";

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "queued", label: "Queued" },
  { value: "cancelled", label: "Cancelled" },
];

const TRIGGER_LABELS: Record<TriggerSource, string> = {
  scheduled: "Scheduled",
  manual: "Manual",
  corrective: "Corrective",
};

export function RunsScreen() {
  const { activeProjectId, filter } = useAppStore();
  const { runs, loading, fetchRuns, updateRunInStore } =
    useRunStore();
  const { jobs, fetchJobs } = useJobStore();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [jobFilter, setJobFilter] = useState<string>("all");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    filter.runId ?? null,
  );

  useEffect(() => {
    if (activeProjectId) {
      fetchRuns(activeProjectId);
      fetchJobs(activeProjectId);
    }
  }, [activeProjectId, fetchRuns, fetchJobs]);

  useEffect(() => {
    if (filter.runId) setSelectedRunId(filter.runId);
  }, [filter.runId]);

  // Listen for live run status changes (may include summary for terminal states)
  const handleStatusChange = useCallback(
    (data: { runId: string; status: RunStatus; summary?: string | null }) => {
      updateRunInStore({
        id: data.runId,
        status: data.status,
        ...(data.summary != null && { summary: data.summary }),
      });
    },
    [updateRunInStore],
  );
  useAgentEvent("run.statusChanged", handleStatusChange);

  // Listen for new runs
  const handleRunCreated = useCallback(
    (data: unknown) => {
      if (activeProjectId) fetchRuns(activeProjectId);
      void data;
    },
    [activeProjectId, fetchRuns],
  );
  useAgentEvent("run.created", handleRunCreated);

  const filteredRuns = useMemo(() => {
    let result = runs;
    if (statusFilter !== "all")
      result = result.filter((r) => r.status === statusFilter);
    if (jobFilter !== "all")
      result = result.filter((r) => r.jobId === jobFilter);
    return result;
  }, [runs, statusFilter, jobFilter]);

  const selectedRun = runs.find((r) => r.id === selectedRunId);
  const getJobName = (jobId: string) => {
    const job = jobs.find((j) => j.id === jobId);
    return job?.name ?? "Deleted job";
  };

  const getEmptyRunsDescription = () => {
    if (runs.length === 0) {
      // Check if any enabled jobs have a future nextFireAt
      const nextJob = jobs
        .filter((j) => j.isEnabled && j.nextFireAt)
        .sort(
          (a, b) =>
            new Date(a.nextFireAt!).getTime() -
            new Date(b.nextFireAt!).getTime(),
        )[0];

      if (nextJob) {
        return `No runs yet. Next scheduled run: '${nextJob.name}' ${formatRelativeTime(nextJob.nextFireAt!)}.`;
      }
    }
    return "No runs yet. Runs will appear here once your jobs start running.";
  };

  if (!activeProjectId) return null;

  return (
    <div className="flex h-full">
      <div
        className={cn("flex-1 overflow-auto p-6", selectedRun && "pr-0")}
      >
        {/* Filters */}
        <div className="mb-4 flex items-center gap-4">
          <h2 className="text-xl font-semibold">Runs</h2>
          <div className="flex-1" />
          <Select value={jobFilter} onValueChange={setJobFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All jobs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All jobs</SelectItem>
              {jobs.map((j) => (
                <SelectItem key={j.id} value={j.id}>
                  {j.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36">
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

        {/* Table */}
        {loading ? (
          <table className="w-full">
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRowSkeleton key={i} cols={5} />
              ))}
            </tbody>
          </table>
        ) : filteredRuns.length === 0 ? (
          <EmptyState
            icon={Play}
            title="No runs"
            description={getEmptyRunsDescription()}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Job</th>
                <th className="px-3 py-2 font-medium">Trigger</th>
                <th className="px-3 py-2 font-medium">Started</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((run) => (
                <tr
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  className={cn(
                    "cursor-pointer border-b border-border transition-colors hover:bg-accent/50",
                    selectedRunId === run.id && "bg-accent",
                  )}
                >
                  <td className="px-3 py-2.5">
                    <RunStatusBadge status={run.status} />
                  </td>
                  <td className="px-3 py-2.5 font-medium">
                    {getJobName(run.jobId)}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {TRIGGER_LABELS[run.triggerSource]}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {run.startedAt
                      ? formatRelativeTime(run.startedAt)
                      : "\u2014"}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {run.startedAt
                      ? formatDuration(getElapsed(run.startedAt, run.finishedAt))
                      : "\u2014"}
                  </td>
                  <td className="max-w-xs truncate px-3 py-2.5 text-xs text-muted-foreground">
                    {run.summary ?? "\u2014"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail Panel */}
      {selectedRun && (
        <RunDetailPanel
          run={selectedRun}
          jobName={getJobName(selectedRun.jobId)}
          onClose={() => setSelectedRunId(null)}
        />
      )}
    </div>
  );
}

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Ban } from "lucide-react";
import { useRunStore } from "@/stores/run-store";
import { useJobStore } from "@/stores/job-store";
import { RunStatusBanner } from "@/components/runs/run-status-banner";
import { LogViewer } from "@/components/runs/log-viewer";
import { useRunLogs } from "@/hooks/use-run-logs";

interface RunDetailViewProps {
  runId: string;
}

export function RunDetailView({ runId }: RunDetailViewProps) {
  const { runs, cancelRun } = useRunStore();
  const { jobs } = useJobStore();
  const run = runs.find((r) => r.id === runId);
  const { logs, loading: logsLoading } = useRunLogs(runId);
  const [cancelling, setCancelling] = useState(false);

  if (!run) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Run not found
      </div>
    );
  }

  const jobName = jobs.find((j) => j.id === run.jobId)?.name ?? "Unknown job";
  const isRunning = run.status === "running";
  const isTerminal = [
    "succeeded",
    "failed",
    "permanent_failure",
    "cancelled",
  ].includes(run.status);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await cancelRun(run.id);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border p-4">
        <h3 className="font-semibold">{jobName}</h3>
        <p className="text-xs text-muted-foreground">
          Run {run.id.slice(0, 8)}
        </p>
      </div>

      {/* Status Banner */}
      <RunStatusBanner run={run} />

      {/* Cancel Button */}
      {isRunning && (
        <div className="border-b border-border px-4 py-2">
          <Button
            variant="destructive"
            size="sm"
            onClick={handleCancel}
            disabled={cancelling}
            className="w-full"
          >
            <Ban className="size-3.5" />
            {cancelling ? "Cancelling..." : "Cancel run"}
          </Button>
        </div>
      )}

      {/* AI Summary */}
      {(isRunning || isTerminal) && (
        <div className="border-b border-border px-4 py-3">
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            Summary
          </h4>
          <p className="text-sm">
            {isRunning
              ? "Summary will appear when the run completes."
              : (run.summary ?? "Summary unavailable.")}
          </p>
        </div>
      )}

      {/* Log Viewer */}
      <div className="flex-1 overflow-hidden">
        <LogViewer
          key={run.id}
          logs={logs}
          loading={logsLoading}
          isLive={isRunning}
        />
      </div>
    </div>
  );
}

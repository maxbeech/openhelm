import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Ban, TerminalSquare, X } from "lucide-react";
import { useRunStore } from "@/stores/run-store";
import { useJobStore } from "@/stores/job-store";
import { useAppStore } from "@/stores/app-store";
import { RunStatusBanner } from "@/components/runs/run-status-banner";
import { LogViewer } from "@/components/runs/log-viewer";
import { useRunLogs } from "@/hooks/use-run-logs";
import { openRunInTerminal } from "@/lib/api";

interface RunDetailViewProps {
  runId: string;
}

export function RunDetailView({ runId }: RunDetailViewProps) {
  const { runs, cancelRun } = useRunStore();
  const { jobs } = useJobStore();
  const { clearSelectedRun } = useAppStore();
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
  const isCancellable = run.status === "running" || run.status === "queued";
  const isTerminal = [
    "succeeded",
    "failed",
    "permanent_failure",
    "cancelled",
  ].includes(run.status);
  const canOpenInTerminal = isTerminal && !!run.sessionId;

  const handleOpenInTerminal = async () => {
    try {
      await openRunInTerminal(run.id);
    } catch (err) {
      console.error("Failed to open run in terminal:", err);
    }
  };

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
      <div className="flex items-start justify-between border-b border-border p-4">
        <div>
          <h3 className="font-semibold">{jobName}</h3>
          <p className="text-xs text-muted-foreground">
            Run {run.id.slice(0, 8)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {canOpenInTerminal && (
            <button
              onClick={handleOpenInTerminal}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"
              title="Open in Terminal"
            >
              <TerminalSquare className="size-3.5" />
              Open
            </button>
          )}
          <button
            onClick={clearSelectedRun}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            title="Close run detail"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Status Banner */}
      <RunStatusBanner run={run} />

      {/* Cancel Button */}
      {isCancellable && (
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

      {/* Correction Context */}
      {run.correctionContext && (
        <div className="border-b border-border px-4 py-3">
          <h4 className="mb-1 text-xs font-medium text-amber-400">
            Correction Context
          </h4>
          <p className="font-mono text-xs text-muted-foreground">
            {run.correctionContext}
          </p>
        </div>
      )}

      {/* Parent Run Link */}
      {run.parentRunId && (
        <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          Triggered by run {run.parentRunId.slice(0, 8)}
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

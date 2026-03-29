import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Ban, TerminalSquare, X, RefreshCw, PlayCircle } from "lucide-react";
import { useRunStore } from "@/stores/run-store";
import { useJobStore } from "@/stores/job-store";
import { useAppStore } from "@/stores/app-store";
import { RunStatusBanner } from "@/components/runs/run-status-banner";
import { RunChainBreadcrumb } from "@/components/runs/run-chain-breadcrumb";
import { LogViewer } from "@/components/runs/log-viewer";
import { useRunLogs } from "@/hooks/use-run-logs";
import { openRunInTerminal, getRun } from "@/lib/api";
import type { Run } from "@openhelm/shared";

interface RunDetailViewProps {
  runId: string;
}

export function RunDetailView({ runId }: RunDetailViewProps) {
  const { runs, cancelRun, triggerRun, retryRun } = useRunStore();
  const { jobs } = useJobStore();
  const { clearSelectedRun, selectJob, selectRunPreserveView } = useAppStore();
  const { logs, loading: logsLoading } = useRunLogs(runId);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [fetchedRun, setFetchedRun] = useState<Run | null>(null);
  const [fetchError, setFetchError] = useState(false);

  const storeRun = runs.find((r) => r.id === runId);
  const run = storeRun ?? fetchedRun;

  useEffect(() => {
    if (storeRun) return;
    setFetchedRun(null);
    setFetchError(false);
    getRun(runId)
      .then(setFetchedRun)
      .catch(() => setFetchError(true));
  }, [runId, storeRun]);

  if (!run) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {fetchError ? "Run not found" : "Loading\u2026"}
      </div>
    );
  }

  const job = jobs.find((j) => j.id === run.jobId);
  const jobName = job?.name ?? "Unknown job";
  const isRunning = run.status === "running";
  const isCancellable = run.status === "running" || run.status === "queued";
  const isTerminal = [
    "succeeded",
    "failed",
    "permanent_failure",
    "cancelled",
  ].includes(run.status);
  const isFailed = run.status === "failed" || run.status === "permanent_failure";
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
          {isTerminal && isFailed && (
            <button
              onClick={() => {
                setActionError(null);
                retryRun(run.jobId, run.id).catch((err: unknown) =>
                  setActionError(err instanceof Error ? err.message : "Retry failed"),
                );
              }}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-destructive hover:bg-accent hover:text-destructive"
              title="Retry failed run"
            >
              <RefreshCw className="size-3.5" />
              Retry
            </button>
          )}
          {isTerminal && (
            <button
              onClick={() => {
                setActionError(null);
                triggerRun(run.jobId).catch((err: unknown) =>
                  setActionError(err instanceof Error ? err.message : "Failed to start run"),
                );
              }}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Start a new run"
            >
              <PlayCircle className="size-3.5" />
              New run
            </button>
          )}
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

      {/* Run Chain Breadcrumb */}
      <RunChainBreadcrumb
        run={run}
        onSelectJob={selectJob}
        onSelectRun={selectRunPreserveView}
      />

      {/* Action error */}
      {actionError && (
        <div className="border-b border-border px-4 py-2 text-xs text-destructive">
          {actionError}
        </div>
      )}

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

      {/* Correction Note */}
      {run.correctionNote && (
        <div className="border-b border-border px-4 py-3">
          <h4 className="mb-1 text-xs font-medium text-amber-400">
            Correction Note
          </h4>
          <p className="font-mono text-xs text-muted-foreground">
            {run.correctionNote}
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

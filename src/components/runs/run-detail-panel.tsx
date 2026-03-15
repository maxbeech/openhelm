import { useState } from "react";
import { Button } from "@/components/ui/button";
import { X, Ban, TerminalSquare } from "lucide-react";
import { useRunStore } from "@/stores/run-store";
import { RunStatusBanner } from "./run-status-banner";
import { LogViewer } from "./log-viewer";
import { useRunLogs } from "@/hooks/use-run-logs";
import { openRunInTerminal } from "@/lib/api";
import type { Run } from "@openorchestra/shared";

interface RunDetailPanelProps {
  run: Run;
  jobName: string;
  onClose: () => void;
}

export function RunDetailPanel({ run, jobName, onClose }: RunDetailPanelProps) {
  const { cancelRun } = useRunStore();
  const { logs, loading: logsLoading } = useRunLogs(run.id);
  const [cancelling, setCancelling] = useState(false);

  const isRunning = run.status === "running";
  const isCancellable = run.status === "running" || run.status === "queued";
  const isTerminal = ["succeeded", "failed", "permanent_failure", "cancelled"].includes(run.status);
  const canOpenInTerminal = isTerminal && !!run.sessionId;

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await cancelRun(run.id);
    } finally {
      setCancelling(false);
    }
  };

  const handleOpenInTerminal = async () => {
    try {
      await openRunInTerminal(run.id);
    } catch (err) {
      console.error("Failed to open run in terminal:", err);
    }
  };

  return (
    <div className="flex h-full w-[480px] flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border p-4">
        <div>
          <h3 className="font-semibold">{jobName}</h3>
          <p className="text-xs text-muted-foreground">Run {run.id.slice(0, 8)}</p>
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
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
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
        <LogViewer key={run.id} logs={logs} loading={logsLoading} isLive={isRunning} />
      </div>
    </div>
  );
}

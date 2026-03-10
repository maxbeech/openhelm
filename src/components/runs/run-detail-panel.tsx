import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { X, Ban } from "lucide-react";
import { useRunStore } from "@/stores/run-store";
import { RunStatusBanner } from "./run-status-banner";
import { LogViewer } from "./log-viewer";
import { useRunLogs } from "@/hooks/use-run-logs";
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
  const isTerminal = ["succeeded", "failed", "permanent_failure", "cancelled"].includes(run.status);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await cancelRun(run.id);
    } finally {
      setCancelling(false);
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
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
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
        <LogViewer key={run.id} logs={logs} loading={logsLoading} isLive={isRunning} />
      </div>
    </div>
  );
}

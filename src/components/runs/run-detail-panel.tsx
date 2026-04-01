import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { X, Ban, TerminalSquare, Brain, ChevronDown, ChevronRight, RefreshCw, PlayCircle } from "lucide-react";
import { useRunStore } from "@/stores/run-store";
import { useAppStore } from "@/stores/app-store";
import { RunStatusBanner } from "./run-status-banner";
import { RunChainBreadcrumb } from "./run-chain-breadcrumb";
import { LogViewer } from "./log-viewer";
import { useRunLogs } from "@/hooks/use-run-logs";
import { openRunInTerminal, listMemoriesForRun } from "@/lib/api";
import { MemoryTypeBadge } from "@/components/memory/memory-type-badge";
import { formatTokenCount } from "@/lib/format";
import type { Run, Memory } from "@openhelm/shared";

interface RunDetailPanelProps {
  run: Run;
  jobName: string;
  onClose: () => void;
}

export function RunDetailPanel({ run, jobName, onClose }: RunDetailPanelProps) {
  const { cancelRun, triggerRun, retryRun } = useRunStore();
  const { selectJob, selectRunPreserveView } = useAppStore();
  const { logs, loading: logsLoading } = useRunLogs(run.id);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runMemories, setRunMemories] = useState<Memory[]>([]);
  const [memoriesExpanded, setMemoriesExpanded] = useState(false);

  useEffect(() => {
    listMemoriesForRun(run.id)
      .then((mems) => setRunMemories(mems))
      .catch(() => setRunMemories([]));
  }, [run.id]);

  const isRunning = run.status === "running";
  const isCancellable = run.status === "running" || run.status === "queued";
  const isTerminal = ["succeeded", "failed", "permanent_failure", "cancelled"].includes(run.status);
  const isFailed = run.status === "failed" || run.status === "permanent_failure";
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
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
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

      {/* Token Usage */}
      {(run.inputTokens != null || run.outputTokens != null) && (
        <div className="border-b border-border px-4 py-3">
          <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">Tokens Used</h4>
          <div className="flex items-center gap-4 text-sm">
            <span>
              <span className="text-2xs text-muted-foreground">in </span>
              <span className="font-mono tabular-nums">{formatTokenCount(run.inputTokens)}</span>
            </span>
            <span>
              <span className="text-2xs text-muted-foreground">out </span>
              <span className="font-mono tabular-nums">{formatTokenCount(run.outputTokens)}</span>
            </span>
            <span className="font-medium font-mono tabular-nums">
              {formatTokenCount((run.inputTokens ?? 0) + (run.outputTokens ?? 0))} total
            </span>
          </div>
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

      {/* Memories Used */}
      {runMemories.length > 0 && (
        <div className="border-b border-border px-4 py-2">
          <button
            onClick={() => setMemoriesExpanded(!memoriesExpanded)}
            className="flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {memoriesExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            <Brain className="size-3" />
            Memories Used ({runMemories.length})
          </button>
          {memoriesExpanded && (
            <div className="mt-2 space-y-1.5">
              {runMemories.map((mem) => (
                <div key={mem.id} className="flex items-start gap-1.5 text-xs">
                  <MemoryTypeBadge type={mem.type} className="mt-0.5 shrink-0" />
                  <span className="text-muted-foreground">{mem.content}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Log Viewer */}
      <div className="flex-1 overflow-hidden">
        <LogViewer key={run.id} logs={logs} loading={logsLoading} isLive={isRunning} />
      </div>
    </div>
  );
}

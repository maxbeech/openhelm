import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { X, Play, Clock, AlertTriangle, Archive, Trash2, CalendarClock } from "lucide-react";
import { RunStatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useJobStore } from "@/stores/job-store";
import { useRunStore } from "@/stores/run-store";
import { useAppStore } from "@/stores/app-store";
import { formatSchedule, formatRelativeTime } from "@/lib/format";
import type { Job, Run } from "@openorchestra/shared";
import { cn } from "@/lib/utils";

interface JobDetailPanelProps {
  job: Job;
  runs: Run[];
  onClose: () => void;
}

export function JobDetailPanel({ job, runs, onClose }: JobDetailPanelProps) {
  const { toggleEnabled, archiveJob, deleteJob } = useJobStore();
  const { triggerRun, triggerDeferredRun, deleteRun, clearRunsByJob } = useRunStore();
  const { selectRun } = useAppStore();
  const [triggering, setTriggering] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    "archive" | "delete" | "clearHistory" | null
  >(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [showDeferredPicker, setShowDeferredPicker] = useState(false);
  const [deferredFireAt, setDeferredFireAt] = useState("");
  const [schedulingDeferred, setSchedulingDeferred] = useState(false);

  const hasRunningRun = runs.some((r) => r.status === "running");
  const recentRuns = runs.slice(0, 20);

  // Minimum datetime: 1 minute from now
  const minDateTime = new Date(Date.now() + 60_000)
    .toISOString()
    .slice(0, 16);

  const handleRunNow = async () => {
    if (hasRunningRun && !showConfirm) {
      setShowConfirm(true);
      return;
    }
    setTriggering(true);
    setShowConfirm(false);
    try {
      await triggerRun(job.id);
    } finally {
      setTriggering(false);
    }
  };

  const handleScheduleDeferred = async () => {
    if (!deferredFireAt) return;
    setSchedulingDeferred(true);
    try {
      await triggerDeferredRun(job.id, new Date(deferredFireAt).toISOString());
      setShowDeferredPicker(false);
      setDeferredFireAt("");
    } finally {
      setSchedulingDeferred(false);
    }
  };

  const handleConfirm = async () => {
    if (!confirmAction) return;
    setConfirmLoading(true);
    try {
      if (confirmAction === "archive") {
        await archiveJob(job.id);
        onClose();
      } else if (confirmAction === "delete") {
        await deleteJob(job.id);
        onClose();
      } else if (confirmAction === "clearHistory") {
        await clearRunsByJob(job.id);
      }
    } finally {
      setConfirmLoading(false);
      setConfirmAction(null);
    }
  };

  const handleDeleteRun = async (runId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingRunId(runId);
    try {
      await deleteRun(runId);
    } finally {
      setDeletingRunId(null);
    }
  };

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border p-4">
        <h3 className="font-semibold">{job.name}</h3>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {/* Description */}
        {job.description && (
          <p className="mb-4 text-sm text-muted-foreground">
            {job.description}
          </p>
        )}

        {/* Prompt */}
        <div className="mb-4">
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            Prompt
          </h4>
          <div className="max-h-32 overflow-auto rounded bg-background p-2 font-mono text-xs">
            {job.prompt}
          </div>
        </div>

        {/* Correction Note */}
        {job.correctionNote && (
          <div className="mb-4">
            <h4 className="mb-1 text-xs font-medium text-amber-400">
              Correction Note
            </h4>
            <div className="max-h-32 overflow-auto rounded bg-background p-2 font-mono text-xs">
              {job.correctionNote}
            </div>
          </div>
        )}

        {/* Schedule */}
        <div className="mb-4 flex items-center gap-2">
          <Clock className="size-3.5 text-muted-foreground" />
          <span className="text-sm">
            {formatSchedule(job.scheduleType, job.scheduleConfig)}
          </span>
        </div>

        {/* Enabled Toggle */}
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm">Enabled</span>
          <Switch
            checked={job.isEnabled}
            onCheckedChange={(checked) => toggleEnabled(job.id, checked)}
          />
        </div>

        {/* Run Now */}
        <div className="mb-2">
          {showConfirm && (
            <div className="mb-2 flex items-start gap-2 rounded bg-warning/10 p-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              This job is already running. Start another run?
            </div>
          )}
          <Button
            onClick={handleRunNow}
            disabled={triggering}
            className="w-full"
            size="sm"
          >
            <Play className="size-3.5" />
            {triggering ? "Starting..." : "Run now"}
          </Button>
        </div>

        {/* Schedule one-off run */}
        <div className="mb-4">
          {showDeferredPicker ? (
            <div className="rounded border border-border bg-background p-3 space-y-2">
              <p className="text-xs text-muted-foreground">Pick a future time to run once:</p>
              <input
                type="datetime-local"
                min={minDateTime}
                value={deferredFireAt}
                onChange={(e) => setDeferredFireAt(e.target.value)}
                className="w-full rounded border border-border bg-card px-2 py-1 text-xs"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={handleScheduleDeferred}
                  disabled={!deferredFireAt || schedulingDeferred}
                >
                  {schedulingDeferred ? "Scheduling..." : "Schedule"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setShowDeferredPicker(false);
                    setDeferredFireAt("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setShowDeferredPicker(true)}
            >
              <CalendarClock className="size-3.5" />
              Schedule one-off run
            </Button>
          )}
        </div>

        <Separator className="my-4" />

        {/* Run History */}
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-medium text-muted-foreground">
            Recent Runs
          </h4>
          {recentRuns.length > 0 && (
            <button
              onClick={() => setConfirmAction("clearHistory")}
              className="text-[10px] text-muted-foreground/60 hover:text-destructive"
            >
              Clear all
            </button>
          )}
        </div>
        {recentRuns.length === 0 ? (
          <p className="text-xs text-muted-foreground">No runs yet</p>
        ) : (
          <div className="space-y-1">
            {recentRuns.map((run) => (
              <div key={run.id} className="group flex items-center gap-1">
                <button
                  onClick={() => selectRun(run.id, run.jobId)}
                  className="flex flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent/50"
                >
                  <RunStatusBadge status={run.status} />
                  <span className="flex-1 text-muted-foreground">
                    {run.status === "deferred" && run.scheduledFor
                      ? `at ${new Date(run.scheduledFor).toLocaleString()}`
                      : formatRelativeTime(run.createdAt)}
                  </span>
                </button>
                <button
                  onClick={(e) => handleDeleteRun(run.id, e)}
                  disabled={deletingRunId === run.id}
                  className={cn(
                    "shrink-0 rounded p-1 opacity-0 group-hover:opacity-100",
                    "text-muted-foreground/60 hover:text-destructive",
                    "transition-opacity disabled:opacity-30",
                  )}
                  title="Delete run"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <Separator className="my-4" />

        {/* Archive & Delete */}
        <div className="flex gap-2">
          {!job.isArchived && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setConfirmAction("archive")}
            >
              <Archive className="size-3.5" />
              Archive
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            className="flex-1"
            onClick={() => setConfirmAction("delete")}
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        </div>
      </div>

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={
          confirmAction === "archive"
            ? "Archive job"
            : confirmAction === "clearHistory"
              ? "Clear run history"
              : "Delete job"
        }
        description={
          confirmAction === "archive"
            ? `This will archive "${job.name}" and disable it. It will appear in the archived section.`
            : confirmAction === "clearHistory"
              ? `This will permanently delete all run history for "${job.name}". This cannot be undone.`
              : `This will permanently delete "${job.name}" and all its runs and logs. This cannot be undone.`
        }
        confirmLabel={
          confirmAction === "archive"
            ? "Archive"
            : confirmAction === "clearHistory"
              ? "Clear history"
              : "Delete"
        }
        variant={
          confirmAction === "archive" ? "default" : "destructive"
        }
        onConfirm={handleConfirm}
        loading={confirmLoading}
      />
    </div>
  );
}

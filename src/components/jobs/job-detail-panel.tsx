import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { X, Play, Clock, AlertTriangle, Archive, Trash2 } from "lucide-react";
import { RunStatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useJobStore } from "@/stores/job-store";
import { useRunStore } from "@/stores/run-store";
import { useAppStore } from "@/stores/app-store";
import { formatSchedule, formatRelativeTime } from "@/lib/format";
import type { Job, Run } from "@openorchestra/shared";

interface JobDetailPanelProps {
  job: Job;
  runs: Run[];
  onClose: () => void;
}

export function JobDetailPanel({ job, runs, onClose }: JobDetailPanelProps) {
  const { toggleEnabled, archiveJob, deleteJob } = useJobStore();
  const { triggerRun } = useRunStore();
  const { selectRun } = useAppStore();
  const [triggering, setTriggering] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    "archive" | "delete" | null
  >(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const hasRunningRun = runs.some((r) => r.status === "running");
  const recentRuns = runs.slice(0, 20);

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

  const handleConfirm = async () => {
    if (!confirmAction) return;
    setConfirmLoading(true);
    try {
      if (confirmAction === "archive") {
        await archiveJob(job.id);
      } else {
        await deleteJob(job.id);
      }
      onClose();
    } finally {
      setConfirmLoading(false);
      setConfirmAction(null);
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
        <div className="mb-4">
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

        <Separator className="my-4" />

        {/* Run History */}
        <h4 className="mb-2 text-xs font-medium text-muted-foreground">
          Recent Runs
        </h4>
        {recentRuns.length === 0 ? (
          <p className="text-xs text-muted-foreground">No runs yet</p>
        ) : (
          <div className="space-y-1">
            {recentRuns.map((run) => (
              <button
                key={run.id}
                onClick={() => selectRun(run.id, run.jobId)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent/50"
              >
                <RunStatusBadge status={run.status} />
                <span className="flex-1 text-muted-foreground">
                  {formatRelativeTime(run.createdAt)}
                </span>
              </button>
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
        title={confirmAction === "archive" ? "Archive job" : "Delete job"}
        description={
          confirmAction === "archive"
            ? `This will archive "${job.name}" and disable it. It will appear in the archived section.`
            : `This will permanently delete "${job.name}" and all its runs and logs. This cannot be undone.`
        }
        confirmLabel={confirmAction === "archive" ? "Archive" : "Delete"}
        variant={confirmAction === "delete" ? "destructive" : "default"}
        onConfirm={handleConfirm}
        loading={confirmLoading}
      />
    </div>
  );
}

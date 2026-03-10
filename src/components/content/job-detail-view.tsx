import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Play,
  Clock,
  AlertTriangle,
  Archive,
  Trash2,
} from "lucide-react";
import { RunStatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useJobStore } from "@/stores/job-store";
import { useRunStore } from "@/stores/run-store";
import { useAppStore } from "@/stores/app-store";
import {
  formatSchedule,
  formatRelativeTime,
  formatDuration,
  getElapsed,
} from "@/lib/format";

interface JobDetailViewProps {
  jobId: string;
}

export function JobDetailView({ jobId }: JobDetailViewProps) {
  const { jobs, toggleEnabled, archiveJob, deleteJob } = useJobStore();
  const { runs, triggerRun } = useRunStore();
  const { selectRun, setContentView } = useAppStore();

  const [triggering, setTriggering] = useState(false);
  const [showRunWarning, setShowRunWarning] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    "archive" | "delete" | null
  >(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const job = jobs.find((j) => j.id === jobId);
  const jobRuns = useMemo(
    () => runs.filter((r) => r.jobId === jobId),
    [runs, jobId],
  );
  const hasRunningRun = jobRuns.some((r) => r.status === "running");

  const handleRunNow = async () => {
    if (hasRunningRun && !showRunWarning) {
      setShowRunWarning(true);
      return;
    }
    setTriggering(true);
    setShowRunWarning(false);
    try {
      await triggerRun(jobId);
    } finally {
      setTriggering(false);
    }
  };

  const handleConfirm = async () => {
    if (!confirmAction) return;
    setConfirmLoading(true);
    try {
      if (confirmAction === "archive") {
        await archiveJob(jobId);
      } else {
        await deleteJob(jobId);
        setContentView("home");
      }
    } finally {
      setConfirmLoading(false);
      setConfirmAction(null);
    }
  };

  if (!job) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Job not found
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold">{job.name}</h2>
        {job.description && (
          <p className="mt-1 text-sm text-muted-foreground">
            {job.description}
          </p>
        )}
      </div>

      {/* Prompt */}
      <div className="mb-6">
        <h4 className="mb-1 text-xs font-medium text-muted-foreground">
          Prompt
        </h4>
        <div className="max-h-40 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs">
          {job.prompt}
        </div>
      </div>

      {/* Meta row */}
      <div className="mb-6 flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Clock className="size-3.5 text-muted-foreground" />
          <span className="text-sm">
            {formatSchedule(job.scheduleType, job.scheduleConfig)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm">Enabled</span>
          <Switch
            checked={job.isEnabled}
            onCheckedChange={(checked) => toggleEnabled(job.id, checked)}
          />
        </div>
      </div>

      {/* Run Now */}
      <div className="mb-6">
        {showRunWarning && (
          <div className="mb-2 flex items-start gap-2 rounded bg-warning/10 p-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            This job is already running. Start another run?
          </div>
        )}
        <Button
          onClick={handleRunNow}
          disabled={triggering}
          size="sm"
        >
          <Play className="size-3.5" />
          {triggering ? "Starting..." : "Run now"}
        </Button>
      </div>

      <Separator className="mb-6" />

      {/* Run History */}
      <h3 className="mb-3 text-sm font-medium">
        Run History ({jobRuns.length})
      </h3>
      {jobRuns.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">No runs yet</p>
      ) : (
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-24" />
            <col className="w-28" />
            <col className="w-24" />
            <col />
          </colgroup>
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Started</th>
              <th className="px-3 py-2 font-medium">Duration</th>
              <th className="px-3 py-2 font-medium">Summary</th>
            </tr>
          </thead>
          <tbody>
            {jobRuns.slice(0, 20).map((run) => (
              <tr
                key={run.id}
                onClick={() => selectRun(run.id, run.jobId)}
                className="cursor-pointer border-b border-border transition-colors hover:bg-accent/50"
              >
                <td className="px-3 py-2.5">
                  <RunStatusBadge status={run.status} />
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  {run.startedAt
                    ? formatRelativeTime(run.startedAt)
                    : "\u2014"}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  {run.startedAt
                    ? formatDuration(
                        getElapsed(run.startedAt, run.finishedAt),
                      )
                    : "\u2014"}
                </td>
                <td className="truncate px-3 py-2.5 text-xs text-muted-foreground">
                  {run.summary ?? "\u2014"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Separator className="my-6" />

      {/* Actions */}
      <div className="flex gap-2">
        {!job.isArchived && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmAction("archive")}
          >
            <Archive className="size-3.5" />
            Archive
          </Button>
        )}
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirmAction("delete")}
        >
          <Trash2 className="size-3.5" />
          Delete
        </Button>
      </div>

      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={confirmAction === "archive" ? "Archive job" : "Delete job"}
        description={
          confirmAction === "archive"
            ? `This will archive "${job.name}" and disable it.`
            : `This will permanently delete "${job.name}" and all its runs and logs.`
        }
        confirmLabel={confirmAction === "archive" ? "Archive" : "Delete"}
        variant={confirmAction === "delete" ? "destructive" : "default"}
        onConfirm={handleConfirm}
        loading={confirmLoading}
      />
    </div>
  );
}

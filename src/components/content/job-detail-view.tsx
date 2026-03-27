import { useState, useMemo } from "react";
import { useNow } from "@/hooks/use-now";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Play,
  Clock,
  AlertTriangle,
  Archive,
  Trash2,
  Pencil,
  RotateCcw,
} from "lucide-react";
import { RunStatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmojiPicker } from "@/components/shared/emoji-picker";
import { JobEditSheet } from "@/components/jobs/job-edit-sheet";
import { CredentialTags } from "@/components/credentials/credential-tags";
import { useJobStore } from "@/stores/job-store";
import { useRunStore } from "@/stores/run-store";
import { useAppStore } from "@/stores/app-store";
import { useProjectStore } from "@/stores/project-store";
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
  const { jobs, updateJob, toggleEnabled, archiveJob, deleteJob } = useJobStore();
  const { runs, triggerRun } = useRunStore();
  const { selectRun, setContentView, activeProjectId } = useAppStore();
  const { projects } = useProjectStore();

  // Tick every minute so relative timestamps (e.g. "Next: in 4h") stay current
  useNow();

  const [triggering, setTriggering] = useState(false);
  const [showRunWarning, setShowRunWarning] = useState(false);
  const [showEditSheet, setShowEditSheet] = useState(false);
  const [credentialRefreshKey, setCredentialRefreshKey] = useState(0);
  const [confirmAction, setConfirmAction] = useState<
    "archive" | "delete" | null
  >(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const activeProject = projects.find((p) => p.id === activeProjectId);

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
        <div className="flex items-center gap-3">
          <EmojiPicker
            value={job.icon}
            onChange={(emoji) => updateJob({ id: job.id, icon: emoji })}
            variant="job"
            className="size-10 text-xl"
          />
          <h2 className="text-xl font-semibold">{job.name}</h2>
        </div>
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

      {/* Credentials */}
      <div className="mb-6">
        <CredentialTags scopeType="job" scopeId={job.id} refreshKey={credentialRefreshKey} />
      </div>

      {/* Correction Note — AI-managed guidance from a previous failure */}
      {job.correctionNote && (
        <div className="mb-6">
          <h4 className="mb-1 text-xs font-medium text-amber-400">
            Correction Note
          </h4>
          <p className="mb-1 text-xs text-muted-foreground">
            AI-generated from a previous failure. May be overridden by the AI after future runs.
          </p>
          <div className="max-h-32 overflow-auto rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 font-mono text-xs">
            {job.correctionNote}
          </div>
          <div className="mt-1.5 flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                updateJob({ id: job.id, correctionNote: null })
              }
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Meta row */}
      <div className="mb-4 flex items-center gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Clock className="size-3.5 shrink-0" />
          <span>{formatSchedule(job.scheduleType, job.scheduleConfig)}</span>
        </div>
        {job.nextFireAt && (
          <span className="text-xs">
            · Next: {formatRelativeTime(job.nextFireAt)}
          </span>
        )}
      </div>

      {/* Actions toolbar */}
      {showRunWarning && (
        <div className="mb-2 flex items-start gap-2 rounded bg-warning/10 p-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          This job is already running. Start another run?
        </div>
      )}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Button onClick={handleRunNow} disabled={triggering} size="sm">
          <Play className="size-3.5" />
          {triggering ? "Starting..." : "Run now"}
        </Button>
        <div className="h-4 w-px bg-border" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowEditSheet(true)}
        >
          <Pencil className="size-3.5" />
          Edit
        </Button>
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
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Enabled</span>
          <Switch
            checked={job.isEnabled}
            onCheckedChange={(checked) => toggleEnabled(job.id, checked)}
          />
        </div>
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
            <col className="w-32" />
            <col className="w-28" />
            <col className="w-20" />
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
                  <div className="flex items-center gap-1.5">
                    <RunStatusBadge status={run.status} />
                    {run.triggerSource === "corrective" && (
                      <span title="Auto-retry">
                        <RotateCcw className="size-3 text-amber-400" />
                      </span>
                    )}
                  </div>
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

      <JobEditSheet
        job={job}
        open={showEditSheet}
        onOpenChange={setShowEditSheet}
        projectDirectory={activeProject?.directoryPath ?? ""}
        onComplete={() => setCredentialRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

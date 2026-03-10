import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  Archive,
  Trash2,
  Briefcase,
  Play,
  Pause,
  Target,
} from "lucide-react";
import {
  GoalStatusBadge,
  RunStatusBadge,
} from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useGoalStore } from "@/stores/goal-store";
import { useJobStore } from "@/stores/job-store";
import { useRunStore } from "@/stores/run-store";
import { useAppStore } from "@/stores/app-store";
import { formatSchedule, formatRelativeTime } from "@/lib/format";
import type { GoalStatus } from "@openorchestra/shared";

interface GoalDetailViewProps {
  goalId: string;
  onNewJob: () => void;
}

export function GoalDetailView({ goalId, onNewJob }: GoalDetailViewProps) {
  const { goals, updateGoalStatus, archiveGoal, deleteGoal } = useGoalStore();
  const { jobs, fetchJobs } = useJobStore();
  const { runs } = useRunStore();
  const { selectJob, setContentView, activeProjectId } = useAppStore();

  const [confirmAction, setConfirmAction] = useState<
    "archive" | "delete" | null
  >(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const goal = goals.find((g) => g.id === goalId);
  const goalJobs = useMemo(
    () => jobs.filter((j) => j.goalId === goalId),
    [jobs, goalId],
  );

  const getLastRunForJob = (jobId: string) =>
    runs.find((r) => r.jobId === jobId);

  const handleStatusChange = async (status: GoalStatus) => {
    await updateGoalStatus(goalId, status);
  };

  const handleConfirm = async () => {
    if (!confirmAction || !activeProjectId) return;
    setConfirmLoading(true);
    try {
      if (confirmAction === "archive") {
        await archiveGoal(goalId);
      } else {
        await deleteGoal(goalId);
        setContentView("home");
      }
      await fetchJobs(activeProjectId);
    } finally {
      setConfirmLoading(false);
      setConfirmAction(null);
    }
  };

  if (!goal) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Goal not found
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold">{goal.name || goal.description}</h2>
        {goal.name && goal.description && (
          <p className="mt-1 text-sm text-muted-foreground">{goal.description}</p>
        )}
        <div className="mt-2 flex items-center gap-3">
          <GoalStatusBadge status={goal.status} />
          {goal.status === "active" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleStatusChange("paused")}
            >
              <Pause className="size-3.5" />
              Pause
            </Button>
          )}
          {goal.status === "paused" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleStatusChange("active")}
            >
              <Target className="size-3.5" />
              Resume
            </Button>
          )}
        </div>
      </div>

      <Separator className="mb-6" />

      {/* Jobs table */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium">
          Jobs ({goalJobs.length})
        </h3>
        <Button size="sm" variant="outline" onClick={onNewJob}>
          <Plus className="size-3.5" />
          Add Job
        </Button>
      </div>

      {goalJobs.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No jobs yet. Add a job to start working towards this goal.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Schedule</th>
              <th className="px-3 py-2 font-medium">Last Run</th>
            </tr>
          </thead>
          <tbody>
            {goalJobs.map((job) => {
              const lastRun = getLastRunForJob(job.id);
              return (
                <tr
                  key={job.id}
                  onClick={() => selectJob(job.id)}
                  className="cursor-pointer border-b border-border transition-colors hover:bg-accent/50"
                >
                  <td className="px-3 py-2.5 font-medium">{job.name}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {formatSchedule(job.scheduleType, job.scheduleConfig)}
                  </td>
                  <td className="px-3 py-2.5">
                    {lastRun ? (
                      <div className="flex items-center gap-1.5">
                        <RunStatusBadge status={lastRun.status} />
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(lastRun.createdAt)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Never
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Separator className="my-6" />

      {/* Actions */}
      <div className="flex gap-2">
        {goal.status !== "archived" && (
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
        title={confirmAction === "archive" ? "Archive goal" : "Delete goal"}
        description={
          confirmAction === "archive"
            ? `This will archive "${(goal.name || goal.description).slice(0, 50)}" and all its jobs.`
            : `This will permanently delete "${(goal.name || goal.description).slice(0, 50)}" and all its jobs, runs, and logs.`
        }
        confirmLabel={confirmAction === "archive" ? "Archive" : "Delete"}
        variant={confirmAction === "delete" ? "destructive" : "default"}
        onConfirm={handleConfirm}
        loading={confirmLoading}
      />
    </div>
  );
}

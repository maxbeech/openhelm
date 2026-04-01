import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  Archive,
  ArchiveRestore,
  Trash2,
  Pencil,
  Play,
  Pause,
  Target,
  Flag,
  Bot,
  Loader2,
} from "lucide-react";
import {
  GoalStatusBadge,
  RunStatusBadge,
} from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmojiPicker } from "@/components/shared/emoji-picker";
import { GoalEditSheet } from "@/components/goals/goal-edit-sheet";
import { CredentialTags } from "@/components/credentials/credential-tags";
import { useGoalStore } from "@/stores/goal-store";
import { useJobStore } from "@/stores/job-store";
import { useRunStore } from "@/stores/run-store";
import { useAppStore } from "@/stores/app-store";
import { formatSchedule, formatRelativeTime, formatTokenCount } from "@/lib/format";
import { getJobTokenStats, generateAutopilotForGoal } from "@/lib/api";
import { useAgentEvent } from "@/hooks/use-agent-event";
import { TargetList } from "@/components/targets/target-list";
import { VisualizationList } from "@/components/visualizations/visualization-list";
import type { GoalStatus, JobTokenStat } from "@openhelm/shared";

interface GoalDetailViewProps {
  goalId: string;
  onNewJob: () => void;
}

export function GoalDetailView({ goalId, onNewJob }: GoalDetailViewProps) {
  const { goals, updateGoal, updateGoalStatus, archiveGoal, unarchiveGoal, deleteGoal } = useGoalStore();
  const { jobs, fetchJobs } = useJobStore();
  const { runs } = useRunStore();
  const { selectJob, setContentView, activeProjectId } = useAppStore();

  const [credentialRefreshKey, setCredentialRefreshKey] = useState(0);
  const [confirmAction, setConfirmAction] = useState<
    "archive" | "delete" | null
  >(null);
  // Stable display action: keeps the last non-null value so dialog content
  // doesn't flicker to "Delete" during the exit animation after Archive.
  const displayAction = useRef<"archive" | "delete">("archive");
  const openConfirm = (action: "archive" | "delete") => {
    displayAction.current = action;
    setConfirmAction(action);
  };
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [showEditSheet, setShowEditSheet] = useState(false);
  const [tokenStats, setTokenStats] = useState<JobTokenStat[]>([]);
  const [generatingAutopilot, setGeneratingAutopilot] = useState(false);

  const goal = goals.find((g) => g.id === goalId);
  const goalJobs = useMemo(
    () => jobs.filter((j) => j.goalId === goalId),
    [jobs, goalId],
  );
  const userJobs = useMemo(() => goalJobs.filter((j) => j.source !== "system"), [goalJobs]);
  const systemJobs = useMemo(() => goalJobs.filter((j) => j.source === "system"), [goalJobs]);

  const getLastRunForJob = (jobId: string) =>
    runs.find((r) => r.jobId === jobId);

  const fetchTokenStatsRef = useRef<() => void>(null!);
  const fetchTokenStats = useCallback(async () => {
    if (goalJobs.length === 0) return;
    try {
      const stats = await getJobTokenStats({ jobIds: goalJobs.map((j) => j.id) });
      setTokenStats(stats);
    } catch {
      // ignore
    }
  }, [goalJobs]);
  fetchTokenStatsRef.current = fetchTokenStats;

  useEffect(() => { fetchTokenStats(); }, [fetchTokenStats]);

  const handleRunStatusChanged = useCallback((data: { status: string }) => {
    const terminal = ["succeeded", "failed", "permanent_failure", "cancelled"];
    if (terminal.includes(data.status)) fetchTokenStatsRef.current();
  }, []);
  useAgentEvent("run.statusChanged", handleRunStatusChanged);

  // Reload jobs when autopilot creates system jobs
  const handleSystemJobsCreated = useCallback((data: { goalId: string }) => {
    if (data.goalId === goalId && activeProjectId) {
      fetchJobs(activeProjectId);
      setGeneratingAutopilot(false);
    }
  }, [goalId, activeProjectId, fetchJobs]);
  useAgentEvent("autopilot.systemJobsCreated", handleSystemJobsCreated);

  const handleGenerateAutopilot = async () => {
    if (!activeProjectId) return;
    setGeneratingAutopilot(true);
    try {
      await generateAutopilotForGoal(goalId, activeProjectId);
      await fetchJobs(activeProjectId);
    } catch (err) {
      console.error("Failed to generate autopilot jobs:", err);
    } finally {
      setGeneratingAutopilot(false);
    }
  };

  const handleStatusChange = async (status: GoalStatus) => {
    await updateGoalStatus(goalId, status);
  };

  const handleConfirm = async () => {
    if (!confirmAction) return;
    setConfirmLoading(true);
    try {
      if (confirmAction === "archive") {
        await archiveGoal(goalId);
      } else {
        await deleteGoal(goalId);
        setContentView("home");
      }
      if (activeProjectId) await fetchJobs(activeProjectId);
    } finally {
      setConfirmLoading(false);
      setConfirmAction(null);
    }
  };

  const handleUnarchive = async () => {
    if (!activeProjectId) return;
    await unarchiveGoal(goalId, activeProjectId);
    await fetchJobs(activeProjectId);
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
        <div className="flex items-center gap-3">
          <EmojiPicker
            value={goal.icon}
            onChange={(emoji) => updateGoal({ id: goal.id, icon: emoji })}
            variant="goal"
            className="size-10 text-xl"
          />
          <h2 className="text-xl font-semibold">{goal.name || goal.description}</h2>
        </div>
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

      {/* Credential tags */}
      <div className="mb-4">
        <CredentialTags scopeType="goal" scopeId={goal.id} refreshKey={credentialRefreshKey} />
      </div>

      {/* Targets */}
      {activeProjectId && (
        <div className="mb-4">
          <TargetList goalId={goalId} projectId={activeProjectId} />
        </div>
      )}

      {/* Visualizations */}
      {activeProjectId && (
        <div className="mb-4">
          <VisualizationList goalId={goalId} projectId={activeProjectId} />
        </div>
      )}

      <Separator className="mb-6" />

      {/* Jobs table */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium">
          Jobs ({userJobs.length})
        </h3>
        <Button size="sm" variant="outline" onClick={onNewJob}>
          <Plus className="size-3.5" />
          Add Job
        </Button>
      </div>

      {userJobs.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No jobs yet. Add a job to start working towards this goal.
        </p>
      ) : (
        <JobsTable jobs={userJobs} tokenStats={tokenStats} getLastRunForJob={getLastRunForJob} selectJob={selectJob} />
      )}

      {/* System Jobs section */}
      <div className="mb-4 mt-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            System Jobs ({systemJobs.length})
          </h3>
          <span className="rounded bg-muted px-1.5 py-0.5 text-3xs text-muted-foreground">Autopilot</span>
        </div>
        {systemJobs.length === 0 && goal.status === "active" && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleGenerateAutopilot}
            disabled={generatingAutopilot}
          >
            {generatingAutopilot ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Bot className="size-3.5" />
            )}
            {generatingAutopilot ? "Generating..." : "Generate"}
          </Button>
        )}
      </div>
      {systemJobs.length > 0 && (
        <JobsTable jobs={systemJobs} tokenStats={tokenStats} getLastRunForJob={getLastRunForJob} selectJob={selectJob} />
      )}

      <Separator className="my-6" />

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowEditSheet(true)}
        >
          <Pencil className="size-3.5" />
          Edit
        </Button>
        {goal.status !== "archived" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => openConfirm("archive")}
          >
            <Archive className="size-3.5" />
            Archive
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={handleUnarchive}
          >
            <ArchiveRestore className="size-3.5" />
            Unarchive
          </Button>
        )}
        <Button
          variant="destructive"
          size="sm"
          onClick={() => openConfirm("delete")}
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
        title={displayAction.current === "archive" ? "Archive goal" : "Delete goal"}
        description={
          displayAction.current === "archive"
            ? `This will archive "${(goal.name || goal.description).slice(0, 50)}" and all its jobs.`
            : `This will permanently delete "${(goal.name || goal.description).slice(0, 50)}" and all its jobs, runs, and logs.`
        }
        confirmLabel={displayAction.current === "archive" ? "Archive" : "Delete"}
        variant={displayAction.current === "delete" ? "destructive" : "default"}
        onConfirm={handleConfirm}
        loading={confirmLoading}
      />

      <GoalEditSheet
        goal={goal}
        open={showEditSheet}
        onOpenChange={setShowEditSheet}
        onComplete={() => setCredentialRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

/** Shared table for both user and system jobs */
function JobsTable({
  jobs: tableJobs,
  tokenStats,
  getLastRunForJob,
  selectJob,
}: {
  jobs: import("@openhelm/shared").Job[];
  tokenStats: JobTokenStat[];
  getLastRunForJob: (jobId: string) => import("@openhelm/shared").Run | undefined;
  selectJob: (jobId: string) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs text-muted-foreground">
          <th className="px-3 py-2 font-medium">Name</th>
          <th className="px-3 py-2 font-medium">Schedule</th>
          <th className="px-3 py-2 font-medium">Last Run</th>
          <th className="px-3 py-2 font-medium text-right">Total Tokens</th>
          <th className="px-3 py-2 font-medium text-right">Avg/Run</th>
        </tr>
      </thead>
      <tbody>
        {tableJobs.map((job) => {
          const lastRun = getLastRunForJob(job.id);
          const stat = tokenStats.find((s) => s.jobId === job.id);
          const totalTokens = stat ? stat.totalInputTokens + stat.totalOutputTokens : null;
          const avgTokens = stat && stat.runCount > 0
            ? Math.round(totalTokens! / stat.runCount)
            : null;
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
                  <span className="text-xs text-muted-foreground">Never</span>
                )}
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
                {formatTokenCount(totalTokens)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
                {formatTokenCount(avgTokens)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

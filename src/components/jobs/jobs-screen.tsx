import { useEffect, useState, useMemo } from "react";
import { Briefcase, Plus, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppStore } from "@/stores/app-store";
import { useJobStore } from "@/stores/job-store";
import { useGoalStore } from "@/stores/goal-store";
import { useRunStore } from "@/stores/run-store";
import { useProjectStore } from "@/stores/project-store";
import { JobDetailPanel } from "./job-detail-panel";
import { JobCreationSheet } from "./job-creation-sheet";
import { RunStatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { TableRowSkeleton } from "@/components/shared/loading-skeleton";
import { formatSchedule, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function JobsScreen() {
  const { activeProjectId, filter, setPage } = useAppStore();
  const { jobs, loading, fetchJobs, toggleEnabled } = useJobStore();
  const { goals, fetchGoals } = useGoalStore();
  const { runs, fetchRuns } = useRunStore();
  const { projects } = useProjectStore();

  const [showDisabled, setShowDisabled] = useState(false);
  const [goalFilter, setGoalFilter] = useState<string>(
    filter.goalId ?? "all",
  );
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [showCreationSheet, setShowCreationSheet] = useState(false);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId),
    [projects, activeProjectId],
  );

  useEffect(() => {
    if (activeProjectId) {
      fetchJobs(activeProjectId);
      fetchGoals(activeProjectId);
      fetchRuns(activeProjectId);
    }
  }, [activeProjectId, fetchJobs, fetchGoals, fetchRuns]);

  useEffect(() => {
    if (filter.goalId) setGoalFilter(filter.goalId);
  }, [filter.goalId]);

  const filteredJobs = useMemo(() => {
    let result = jobs;
    if (!showDisabled) result = result.filter((j) => j.isEnabled);
    if (goalFilter !== "all")
      result = result.filter((j) => j.goalId === goalFilter);
    return result;
  }, [jobs, showDisabled, goalFilter]);

  const selectedJob = jobs.find((j) => j.id === selectedJobId);

  const getLastRunForJob = (jobId: string) =>
    runs.find((r) => r.jobId === jobId);

  const getGoalName = (goalId: string | null) =>
    goalId ? goals.find((g) => g.id === goalId)?.description : null;

  if (!activeProjectId) return null;

  return (
    <div className="flex h-full">
      <div className={cn("flex-1 overflow-auto p-6", selectedJob && "pr-0")}>
        {/* Header with filters */}
        <div className="mb-4 flex items-center gap-4">
          <h2 className="text-xl font-semibold">Jobs</h2>
          <div className="flex-1" />
          <Select value={goalFilter} onValueChange={setGoalFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All goals" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All goals</SelectItem>
              {goals.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.description.slice(0, 30)}
                  {g.description.length > 30 ? "..." : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={showDisabled} onCheckedChange={setShowDisabled} />
            Show disabled
          </label>
          <Button
            size="sm"
            onClick={() => setShowCreationSheet(true)}
          >
            <Plus className="size-4" />
            New job
          </Button>
        </div>

        {/* Table */}
        {loading ? (
          <table className="w-full">
            <tbody>
              {Array.from({ length: 3 }).map((_, i) => (
                <TableRowSkeleton key={i} cols={5} />
              ))}
            </tbody>
          </table>
        ) : filteredJobs.length === 0 ? (
          jobs.length === 0 ? (
            <EmptyState
              icon={Briefcase}
              title="No jobs yet"
              description="Jobs are created when you set a goal, or you can create one manually."
              action={
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage("goals")}
                  >
                    <Target className="size-4" />
                    Set a goal
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setShowCreationSheet(true)}
                  >
                    <Plus className="size-4" />
                    Create job
                  </Button>
                </div>
              }
            />
          ) : (
            <EmptyState
              icon={Briefcase}
              title="No jobs"
              description={
                showDisabled
                  ? "No jobs match the current filters."
                  : "No enabled jobs. Toggle 'Show disabled' to see all."
              }
            />
          )
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Goal</th>
                <th className="px-3 py-2 font-medium">Schedule</th>
                <th className="px-3 py-2 font-medium">Enabled</th>
                <th className="px-3 py-2 font-medium">Last Run</th>
                <th className="px-3 py-2 font-medium">Next</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.map((job) => {
                const lastRun = getLastRunForJob(job.id);
                const goalName = getGoalName(job.goalId);
                return (
                  <tr
                    key={job.id}
                    onClick={() => setSelectedJobId(job.id)}
                    className={cn(
                      "cursor-pointer border-b border-border transition-colors hover:bg-accent/50",
                      selectedJobId === job.id && "bg-accent",
                    )}
                  >
                    <td className="px-3 py-2.5 font-medium">{job.name}</td>
                    <td className="px-3 py-2.5">
                      {goalName ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {goalName.slice(0, 25)}
                          {goalName.length > 25 ? "..." : ""}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          &mdash;
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {formatSchedule(job.scheduleType, job.scheduleConfig)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Switch
                        checked={job.isEnabled}
                        onCheckedChange={(checked) =>
                          toggleEnabled(job.id, checked)
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
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
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {job.nextFireAt
                        ? formatRelativeTime(job.nextFireAt)
                        : "\u2014"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail Panel */}
      {selectedJob && (
        <JobDetailPanel
          job={selectedJob}
          runs={runs.filter((r) => r.jobId === selectedJob.id)}
          onClose={() => setSelectedJobId(null)}
        />
      )}

      {/* Creation Sheet */}
      {activeProject && (
        <JobCreationSheet
          open={showCreationSheet}
          onOpenChange={setShowCreationSheet}
          projectId={activeProjectId}
          projectDirectory={activeProject.directoryPath}
          onComplete={() => fetchJobs(activeProjectId)}
        />
      )}
    </div>
  );
}

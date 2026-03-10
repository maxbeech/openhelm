import { useState, useMemo } from "react";
import { ChevronRight, FileText, Briefcase, Plus } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useGoalStore } from "@/stores/goal-store";
import { useJobStore } from "@/stores/job-store";
import { useRunStore } from "@/stores/run-store";
import { cn } from "@/lib/utils";

interface SidebarTreeProps {
  projectId: string;
  onNewJobForGoal: (goalId: string, initialName: string) => void;
}

export function SidebarTree({ projectId, onNewJobForGoal }: SidebarTreeProps) {
  const {
    contentView,
    selectedGoalId,
    selectedJobId,
    collapsedGoalIds,
    selectGoal,
    selectJob,
    toggleGoalCollapsed,
  } = useAppStore();
  const { goals, createGoal } = useGoalStore();
  const { jobs } = useJobStore();
  const { runs } = useRunStore();

  const [addingGoal, setAddingGoal] = useState(false);
  const [newGoalInput, setNewGoalInput] = useState("");
  const [addingJobForGoalId, setAddingJobForGoalId] = useState<string | null>(
    null,
  );
  const [newJobInput, setNewJobInput] = useState("");

  const activeGoals = useMemo(
    () => goals.filter((g) => g.status !== "archived"),
    [goals],
  );

  const jobsByGoal = useMemo(() => {
    const map = new Map<string | null, typeof jobs>();
    for (const job of jobs) {
      if (job.isArchived) continue;
      const key = job.goalId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(job);
    }
    return map;
  }, [jobs]);

  const standaloneJobs = useMemo(
    () => jobsByGoal.get(null) ?? [],
    [jobsByGoal],
  );

  const runningJobIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of runs) {
      if (run.status === "running") ids.add(run.jobId);
    }
    return ids;
  }, [runs]);

  const handleCreateGoal = async () => {
    const name = newGoalInput.trim();
    setNewGoalInput("");
    setAddingGoal(false);
    if (!name) return;
    try {
      const goal = await createGoal({ projectId, name });
      selectGoal(goal.id);
    } catch {
      // goal-store sets error state
    }
  };

  const handleSubmitJobInput = (goalId: string) => {
    const name = newJobInput.trim();
    setNewJobInput("");
    setAddingJobForGoalId(null);
    if (name) onNewJobForGoal(goalId, name);
  };

  return (
    <div className="flex-1 overflow-auto p-2">
      {/* Goals header */}
      <div className="mb-1 flex items-center gap-1 px-1">
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Goals
        </span>
        <button
          onClick={() => {
            setAddingGoal(true);
            setNewGoalInput("");
          }}
          className="rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          title="New goal"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {/* Inline goal name input */}
      {addingGoal && (
        <div className="mb-1 px-1">
          <input
            autoFocus
            value={newGoalInput}
            onChange={(e) => setNewGoalInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateGoal();
              if (e.key === "Escape") {
                setNewGoalInput("");
                setAddingGoal(false);
              }
            }}
            onBlur={handleCreateGoal}
            placeholder="Goal name..."
            className="w-full rounded-md bg-sidebar-accent px-2 py-1 text-sm text-sidebar-foreground outline-none ring-1 ring-primary/50"
          />
        </div>
      )}

      {/* Goal nodes */}
      {activeGoals.map((goal) => {
        const goalJobs = jobsByGoal.get(goal.id) ?? [];
        const isCollapsed = collapsedGoalIds.includes(goal.id);
        const isSelected =
          contentView === "goal-detail" && selectedGoalId === goal.id;

        return (
          <div key={goal.id} className="group mb-0.5">
            <div className="flex items-center">
              <button
                onClick={() => toggleGoalCollapsed(goal.id)}
                className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 transition-transform",
                    !isCollapsed && "rotate-90",
                  )}
                />
              </button>
              <button
                onClick={() => selectGoal(goal.id)}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm transition-colors",
                  isSelected
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50",
                )}
              >
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{goal.name || goal.description}</span>
              </button>
              <button
                onClick={() => {
                  setAddingJobForGoalId(goal.id);
                  setNewJobInput("");
                }}
                className="ml-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-foreground group-hover:opacity-100"
                title="New job in this goal"
              >
                <Plus className="size-3" />
              </button>
            </div>

            {/* Inline job name input */}
            {addingJobForGoalId === goal.id && (
              <div className="py-0.5 pl-5 pr-1">
                <input
                  autoFocus
                  value={newJobInput}
                  onChange={(e) => setNewJobInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSubmitJobInput(goal.id);
                    if (e.key === "Escape") {
                      setNewJobInput("");
                      setAddingJobForGoalId(null);
                    }
                  }}
                  onBlur={() => {
                    setNewJobInput("");
                    setAddingJobForGoalId(null);
                  }}
                  placeholder="Job name..."
                  className="w-full rounded-md bg-sidebar-accent px-2 py-1 text-xs text-sidebar-foreground outline-none ring-1 ring-primary/50"
                />
              </div>
            )}

            {/* Nested jobs */}
            {!isCollapsed &&
              goalJobs.map((job) => (
                <JobNode
                  key={job.id}
                  jobId={job.id}
                  name={job.name}
                  isSelected={
                    (contentView === "job-detail" || contentView === "run-detail") && selectedJobId === job.id
                  }
                  isRunning={runningJobIds.has(job.id)}
                  onSelect={() => selectJob(job.id)}
                />
              ))}
          </div>
        );
      })}

      {/* Standalone jobs (no goal) */}
      {standaloneJobs.length > 0 && (
        <div className="mt-2 border-t border-sidebar-border pt-2">
          <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Jobs
          </p>
          {standaloneJobs.map((job) => (
            <JobNode
              key={job.id}
              jobId={job.id}
              name={job.name}
              isSelected={
                (contentView === "job-detail" || contentView === "run-detail") && selectedJobId === job.id
              }
              isRunning={runningJobIds.has(job.id)}
              onSelect={() => selectJob(job.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function JobNode({
  name,
  isSelected,
  isRunning,
  onSelect,
}: {
  jobId: string;
  name: string;
  isSelected: boolean;
  isRunning: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md py-1 pl-7 pr-1.5 text-sm transition-colors",
        isSelected
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
      )}
    >
      <Briefcase className="size-3.5 shrink-0" />
      <span className={cn("truncate", isSelected && "font-medium")}>
        {name}
      </span>
      {isRunning && (
        <span className="ml-auto size-2 shrink-0 animate-pulse rounded-full bg-primary" />
      )}
    </button>
  );
}

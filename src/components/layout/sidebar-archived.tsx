import { useState } from "react";
import { ChevronRight, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import { NodeIcon } from "@/components/shared/node-icon";
import { SidebarJobNode } from "./sidebar-job-node";
import type { Goal, Job, Run } from "@openhelm/shared";
import type { ContentView } from "@/stores/app-store";

interface SidebarArchivedProps {
  archivedGoals: Goal[];
  archivedStandaloneJobs: Job[];
  archivedJobsByGoal: Map<string, Job[]>;
  recentRunsByJob: Map<string, Run[]>;
  contentView: ContentView;
  selectedGoalId: string | null;
  selectedJobId: string | null;
  selectGoal: (id: string) => void;
  selectJob: (id: string) => void;
  archivedCount: number;
}

export function SidebarArchived({
  archivedGoals,
  archivedStandaloneJobs,
  archivedJobsByGoal,
  recentRunsByJob,
  contentView,
  selectedGoalId,
  selectedJobId,
  selectGoal,
  selectJob,
  archivedCount,
}: SidebarArchivedProps) {
  const [showArchived, setShowArchived] = useState(false);

  return (
    <div className="mt-3 border-t border-sidebar-border pt-3">
      <button
        onClick={() => setShowArchived((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1 text-3xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-sidebar-foreground"
      >
        <ChevronRight
          className={cn(
            "size-3 transition-transform",
            showArchived && "rotate-90",
          )}
        />
        <Archive className="size-3" />
        Archived ({archivedCount})
      </button>
      {showArchived && (
        <div className="opacity-60">
          {archivedGoals.map((goal) => {
            const goalArchivedJobs = archivedJobsByGoal.get(goal.id) ?? [];
            const isSelected =
              contentView === "goal-detail" && selectedGoalId === goal.id;
            return (
              <div key={goal.id}>
                <button
                  onClick={() => selectGoal(goal.id)}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-md px-3 py-1 text-sm transition-colors",
                    isSelected
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50",
                  )}
                >
                  <NodeIcon icon={goal.icon} defaultIcon="flag" />
                  <span className="truncate">
                    {goal.name || goal.description}
                  </span>
                </button>
                {goalArchivedJobs.map((job) => (
                  <SidebarJobNode
                    key={job.id}
                    job={job}
                    recentRuns={recentRunsByJob.get(job.id) ?? []}
                    isSelected={
                      contentView === "job-detail" && selectedJobId === job.id
                    }
                    onSelect={() => selectJob(job.id)}
                  disableDrag
                  />
                ))}
              </div>
            );
          })}
          {archivedStandaloneJobs.map((job) => (
            <SidebarJobNode
              key={job.id}
              job={job}
              recentRuns={recentRunsByJob.get(job.id) ?? []}
              isSelected={
                contentView === "job-detail" && selectedJobId === job.id
              }
              onSelect={() => selectJob(job.id)}
              disableDrag
            />
          ))}
        </div>
      )}
    </div>
  );
}

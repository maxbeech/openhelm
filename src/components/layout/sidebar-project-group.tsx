import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { SidebarGoalNode } from "./sidebar-goal-node";
import { GoalCreationSheet } from "@/components/goals/goal-creation-sheet";
import { buildGoalTree } from "@/lib/goal-tree";
import type { Project, Goal, Job, Run } from "@openhelm/shared";
import type { ContentView } from "@/stores/app-store";

interface SidebarProjectGroupProps {
  project: Project;
  goals: Goal[];
  standaloneJobs: Job[];
  jobsByGoal: Map<string | null, Job[]>;
  recentRunsByJob: Map<string, Run[]>;
  contentView: ContentView;
  selectedGoalId: string | null;
  selectedJobId: string | null;
  collapsedGoalIds: string[];
  isCollapsed: boolean;
  dropTargetGoalId: string | null;
  activeDragId: string | null;
  onSelectGoal: (id: string) => void;
  onSelectJob: (id: string) => void;
  onToggleCollapsed: () => void;
  onToggleGoalCollapsed: (id: string) => void;
  onNewJobForGoal: (goalId: string, initialName: string) => void;
  onMoveToRoot: (goalId: string) => void;
  onArchiveGoal: (goalId: string) => void;
  onDeleteGoal: (goalId: string) => void;
  onCloseSearch?: () => void;
}

export function SidebarProjectGroup({
  project,
  goals,
  standaloneJobs,
  jobsByGoal,
  recentRunsByJob,
  contentView,
  selectedGoalId,
  selectedJobId,
  collapsedGoalIds,
  isCollapsed,
  dropTargetGoalId,
  activeDragId,
  onSelectGoal,
  onSelectJob,
  onToggleCollapsed,
  onToggleGoalCollapsed,
  onNewJobForGoal,
  onMoveToRoot,
  onArchiveGoal,
  onDeleteGoal,
  onCloseSearch,
}: SidebarProjectGroupProps) {

  const goalTree = useMemo(() => buildGoalTree(goals), [goals]);
  const [pendingSubGoalParentId, setPendingSubGoalParentId] = useState<string | null>(null);

  return (
    <div className="mb-2">
      {/* Project group header */}
      <div className="group flex items-center gap-1 px-3 py-1">
        <button
          onClick={onToggleCollapsed}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
        >
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              !isCollapsed && "rotate-90",
            )}
          />
          <span className="truncate text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
            {project.name}
          </span>
        </button>
      </div>

      {/* Project group content */}
      {!isCollapsed && (
        <div>
          {goalTree.map((node) => (
            <SidebarGoalNode
              key={node.id}
              goal={node}
              goalJobs={jobsByGoal.get(node.id) ?? []}
              recentRunsByJob={recentRunsByJob}
              isCollapsed={collapsedGoalIds.includes(node.id)}
              isSelected={contentView === "goal-detail" && selectedGoalId === node.id}
              contentView={contentView}
              selectedGoalId={selectedGoalId}
              selectedJobId={selectedJobId}
              dropTargetGoalId={dropTargetGoalId}
              activeDragId={activeDragId}
              collapsedGoalIds={collapsedGoalIds}
              filteredJobsByGoal={jobsByGoal}
              onToggleCollapsed={() => onToggleGoalCollapsed(node.id)}
              onToggleGoalCollapsed={onToggleGoalCollapsed}
              onSelectGoal={onSelectGoal}
              onSelectJob={onSelectJob}
              onNewJobForGoal={onNewJobForGoal}
              onNewSubGoal={(parentGoalId) => setPendingSubGoalParentId(parentGoalId)}
              onMoveToRoot={onMoveToRoot}
              onArchiveGoal={onArchiveGoal}
              onDeleteGoal={onDeleteGoal}
              onCloseSearch={onCloseSearch}
            />
          ))}
          {standaloneJobs.length > 0 && standaloneJobs.map((job) => (
            <button
              key={job.id}
              onClick={() => onSelectJob(job.id)}
              className={cn(
                "mb-0.5 flex w-full items-center gap-1.5 rounded-md py-1 pl-7 pr-2 text-left text-sm transition-colors",
                contentView === "job-detail" && selectedJobId === job.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              )}
            >
              <span className="truncate">{job.name}</span>
            </button>
          ))}
        </div>
      )}

      {pendingSubGoalParentId && (
        <GoalCreationSheet
          open={true}
          onOpenChange={(open) => { if (!open) setPendingSubGoalParentId(null); }}
          projectId={project.id}
          parentGoalId={pendingSubGoalParentId}
          onComplete={() => setPendingSubGoalParentId(null)}
        />
      )}
    </div>
  );
}

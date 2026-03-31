// No local collapse state — collapse is managed by the app store for persistence
import { ChevronRight, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SidebarGoalNode } from "./sidebar-goal-node";
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
  isDragMode: boolean;
  isDragActive: boolean;
  onSelectGoal: (id: string) => void;
  onSelectJob: (id: string) => void;
  onToggleCollapsed: () => void;
  onToggleGoalCollapsed: (id: string) => void;
  onNewJobForGoal: (goalId: string, initialName: string) => void;
  onCloseSearch?: () => void;
  // Drag handle for job nodes within goal
  jobDragMode: boolean;
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
  isDragMode,
  isDragActive,
  onSelectGoal,
  onSelectJob,
  onToggleCollapsed,
  onToggleGoalCollapsed,
  onNewJobForGoal,
  onCloseSearch,
  jobDragMode,
}: SidebarProjectGroupProps) {

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useSortable({ id: project.id, disabled: !isDragMode });

  // No transition — prevents the FLIP snap-back animation on drag release
  const style = { transform: CSS.Transform.toString(transform) };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("mb-2", isDragging && "opacity-50")}
    >
      {/* Project group header */}
      <div className="group flex items-center gap-1 px-3 py-1">
        {/* Grip always rendered to prevent layout shift; invisible when drag inactive */}
        <span
          {...(isDragMode ? { ...attributes, ...listeners } : {})}
          className={cn(
            "shrink-0",
            isDragMode
              ? "cursor-grab text-muted-foreground/40 opacity-0 transition-opacity hover:text-muted-foreground group-hover:opacity-100 active:cursor-grabbing"
              : "invisible pointer-events-none cursor-default",
          )}
        >
          <GripVertical className="size-3" />
        </span>
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
          <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {project.name}
          </span>
        </button>
      </div>

      {/* Project group content */}
      {!isCollapsed && (
        <div>
          {goals.map((goal) => (
            <SidebarGoalNode
              key={goal.id}
              goal={goal}
              goalJobs={jobsByGoal.get(goal.id) ?? []}
              recentRunsByJob={recentRunsByJob}
              isCollapsed={collapsedGoalIds.includes(goal.id)}
              isSelected={contentView === "goal-detail" && selectedGoalId === goal.id}
              contentView={contentView}
              selectedJobId={selectedJobId}
              onToggleCollapsed={() => onToggleGoalCollapsed(goal.id)}
              onSelectGoal={() => onSelectGoal(goal.id)}
              onSelectJob={onSelectJob}
              onNewJobForGoal={onNewJobForGoal}
              onCloseSearch={onCloseSearch}
              isDragMode={isDragMode}
              isDragActive={isDragActive}
              jobDragMode={jobDragMode}
            />
          ))}
          {standaloneJobs.length > 0 && standaloneJobs.map((job) => {
            // Standalone jobs within a project group — not sortable here (handled at tree level)
            return (
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
            );
          })}
        </div>
      )}
    </div>
  );
}

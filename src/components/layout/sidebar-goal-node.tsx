import { useState } from "react";
import { ChevronRight, GripVertical, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { NodeIcon } from "@/components/shared/node-icon";
import { SidebarJobNode } from "./sidebar-job-node";
import type { Goal, Job, Run } from "@openhelm/shared";
import type { ContentView } from "@/stores/app-store";

interface SidebarGoalNodeProps {
  goal: Goal;
  goalJobs: Job[];
  recentRunsByJob: Map<string, Run[]>;
  isCollapsed: boolean;
  isSelected: boolean;
  contentView: ContentView;
  selectedJobId: string | null;
  isDragMode: boolean;
  jobDragMode: boolean;
  onToggleCollapsed: () => void;
  onSelectGoal: () => void;
  onSelectJob: (jobId: string) => void;
  onNewJobForGoal: (goalId: string, initialName: string) => void;
}

export function SidebarGoalNode({
  goal,
  goalJobs,
  recentRunsByJob,
  isCollapsed,
  isSelected,
  contentView,
  selectedJobId,
  isDragMode,
  jobDragMode,
  onToggleCollapsed,
  onSelectGoal,
  onSelectJob,
  onNewJobForGoal,
}: SidebarGoalNodeProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: goal.id, disabled: !isDragMode });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const [addingJob, setAddingJob] = useState(false);
  const [newJobInput, setNewJobInput] = useState("");

  const handleSubmitJob = () => {
    const name = newJobInput.trim();
    setNewJobInput("");
    setAddingJob(false);
    if (name) onNewJobForGoal(goal.id, name);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("group mb-3", isDragging && "opacity-50")}
    >
      {/* Goal header row — sticky below the GOALS header (~30px) */}
      <div className="sticky top-[30px] z-10 bg-sidebar px-3">
        <div className="flex items-center">
          {isDragMode && (
            <span
              {...attributes}
              {...listeners}
              className="mr-0.5 cursor-grab text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
            >
              <GripVertical className="size-3.5" />
            </span>
          )}
          <button
            onClick={onToggleCollapsed}
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
            onClick={onSelectGoal}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm transition-colors",
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
          <button
            onClick={() => {
              setAddingJob(true);
              setNewJobInput("");
            }}
            className="ml-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-foreground group-hover:opacity-100"
            title="New job in this goal"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Inline job name input */}
      {addingJob && (
        <div className="py-0.5 pl-8 pr-3">
          <input
            autoFocus
            value={newJobInput}
            onChange={(e) => setNewJobInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmitJob();
              if (e.key === "Escape") {
                setNewJobInput("");
                setAddingJob(false);
              }
            }}
            onBlur={handleSubmitJob}
            placeholder="Job name..."
            className="w-full rounded-md bg-sidebar-accent px-2 py-1 text-xs text-sidebar-foreground outline-none ring-1 ring-primary/50"
          />
        </div>
      )}

      {/* Nested jobs */}
      {!isCollapsed && (
        <SortableContext
          items={goalJobs.map((j) => j.id)}
          strategy={verticalListSortingStrategy}
        >
          {goalJobs.map((job) => (
            <SidebarJobNode
              key={job.id}
              job={job}
              recentRuns={recentRunsByJob.get(job.id) ?? []}
              isSelected={contentView === "job-detail" && selectedJobId === job.id}
              onSelect={() => onSelectJob(job.id)}
              isDragMode={jobDragMode}
            />
          ))}
        </SortableContext>
      )}
    </div>
  );
}

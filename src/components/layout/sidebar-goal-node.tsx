import { useState, useRef, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { NodeIcon } from "@/components/shared/node-icon";
import { SidebarJobNode } from "./sidebar-job-node";
import { SidebarGoalAddMenu } from "./sidebar-goal-add-menu";
import { SidebarGoalContextMenu } from "./sidebar-goal-context-menu";
import type { Job, Run, GoalTreeNode } from "@openhelm/shared";
import type { ContentView } from "@/stores/app-store";

interface SidebarGoalNodeProps {
  goal: GoalTreeNode;
  goalJobs: Job[];
  recentRunsByJob: Map<string, Run[]>;
  isCollapsed: boolean;
  isSelected: boolean;
  contentView: ContentView;
  selectedGoalId: string | null;
  selectedJobId: string | null;
  dropTargetGoalId: string | null;
  activeDragId: string | null;
  collapsedGoalIds: string[];
  filteredJobsByGoal: Map<string | null, Job[]>;
  onToggleCollapsed: () => void;
  onToggleGoalCollapsed: (id: string) => void;
  onSelectGoal: (id: string) => void;
  onSelectJob: (jobId: string) => void;
  onNewJobForGoal: (goalId: string, initialName: string) => void;
  onNewSubGoal: (parentGoalId: string) => void;
  onMoveToRoot: (goalId: string) => void;
  onArchiveGoal: (goalId: string) => void;
  onDeleteGoal: (goalId: string) => void;
  onCloseSearch?: () => void;
}

export function SidebarGoalNode({
  goal, goalJobs, recentRunsByJob, isCollapsed, isSelected,
  contentView, selectedGoalId, selectedJobId, dropTargetGoalId, activeDragId,
  collapsedGoalIds, filteredJobsByGoal,
  onToggleCollapsed, onToggleGoalCollapsed, onSelectGoal, onSelectJob,
  onNewJobForGoal, onNewSubGoal, onMoveToRoot, onArchiveGoal, onDeleteGoal, onCloseSearch,
}: SidebarGoalNodeProps) {
  const {
    attributes, listeners, setNodeRef: setDragRef, isDragging,
  } = useDraggable({
    id: goal.id,
    data: { type: "goal", goalId: goal.id },
  });

  // Droppable is ONLY on the header row — not the entire subtree.
  // This ensures hovering over a goal's header targets that specific goal,
  // not a parent goal whose subtree wrapper contains the pointer.
  const { setNodeRef: setDropRef } = useDroppable({
    id: `drop-${goal.id}`,
    data: { type: "goal", goalId: goal.id },
  });

  const indent = goal.depth * 16;

  const [addingJob, setAddingJob] = useState(false);
  const [newJobInput, setNewJobInput] = useState("");
  const jobSubmittingRef = useRef(false);

  const handleSubmitJob = useCallback(() => {
    if (jobSubmittingRef.current) return;
    const name = newJobInput.trim();
    setNewJobInput("");
    setAddingJob(false);
    if (!name) return;
    jobSubmittingRef.current = true;
    try { onNewJobForGoal(goal.id, name); } finally { jobSubmittingRef.current = false; }
  }, [newJobInput, goal.id, onNewJobForGoal]);

  const isDropTarget = dropTargetGoalId === goal.id && activeDragId !== goal.id;

  return (
    <div>
      {/* Combined drag handle + drop target on the header row only */}
      <div
        ref={(node) => { setDragRef(node); setDropRef(node); }}
        {...attributes}
        {...listeners}
        style={{ paddingLeft: `${4 + indent}px` }}
        className={cn(
          "bg-sidebar pr-3 cursor-grab active:cursor-grabbing select-none",
          !isDragging && "sticky top-[30px] z-10",
          isDragging && "opacity-30 pointer-events-none",
        )}
      >
        <SidebarGoalContextMenu
          goal={goal}
          onNewSubGoal={() => onNewSubGoal(goal.id)}
          onNewJob={() => { onCloseSearch?.(); setAddingJob(true); setNewJobInput(""); }}
          onMoveToRoot={() => onMoveToRoot(goal.id)}
          onArchive={() => onArchiveGoal(goal.id)}
          onDelete={() => onDeleteGoal(goal.id)}
        >
          <div className="flex items-center">
            <button
              onClick={(e) => { e.stopPropagation(); onToggleCollapsed(); }}
              className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <motion.span
                animate={{ rotate: isCollapsed ? 0 : 90 }}
                transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                className="flex items-center justify-center"
              >
                <ChevronRight className="size-3.5" />
              </motion.span>
            </button>
            <button
              onClick={() => onSelectGoal(goal.id)}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium transition-colors",
                isSelected
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50",
              )}
            >
              <NodeIcon icon={goal.icon} defaultIcon="flag" variant="goal" />
              <span className="truncate">{goal.name || goal.description}</span>
            </button>
            <SidebarGoalAddMenu
              onNewSubGoal={() => onNewSubGoal(goal.id)}
              onNewJob={() => { onCloseSearch?.(); setAddingJob(true); setNewJobInput(""); }}
            />
          </div>
        </SidebarGoalContextMenu>
      </div>

      {/* Drop indicator — directly below the goal header, at child indent */}
      {isDropTarget && (
        <div
          className="py-px"
          style={{ paddingLeft: `${4 + (goal.depth + 1) * 16}px`, paddingRight: 12 }}
        >
          <div className="h-0.5 rounded-full bg-primary" />
        </div>
      )}

      {addingJob && (
        <div className="py-0.5 pr-3" style={{ paddingLeft: `${32 + indent}px` }}>
          <input
            autoFocus
            value={newJobInput}
            onChange={(e) => setNewJobInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmitJob();
              if (e.key === "Escape") { setNewJobInput(""); setAddingJob(false); }
            }}
            onBlur={handleSubmitJob}
            placeholder="Job name..."
            className="w-full rounded-md bg-sidebar-accent px-2 py-1 text-sm text-sidebar-foreground outline-none ring-1 ring-primary/50"
          />
        </div>
      )}

      {!isCollapsed && (
        <div>
          {goal.children.map((child) => (
            <SidebarGoalNode
              key={child.id}
              goal={child}
              goalJobs={filteredJobsByGoal.get(child.id) ?? []}
              recentRunsByJob={recentRunsByJob}
              isCollapsed={collapsedGoalIds.includes(child.id)}
              isSelected={contentView === "goal-detail" && selectedGoalId === child.id}
              contentView={contentView}
              selectedGoalId={selectedGoalId}
              selectedJobId={selectedJobId}
              dropTargetGoalId={dropTargetGoalId}
              activeDragId={activeDragId}
              collapsedGoalIds={collapsedGoalIds}
              filteredJobsByGoal={filteredJobsByGoal}
              onToggleCollapsed={() => onToggleGoalCollapsed(child.id)}
              onToggleGoalCollapsed={onToggleGoalCollapsed}
              onSelectGoal={onSelectGoal}
              onSelectJob={onSelectJob}
              onNewJobForGoal={onNewJobForGoal}
              onNewSubGoal={onNewSubGoal}
              onMoveToRoot={onMoveToRoot}
              onArchiveGoal={onArchiveGoal}
              onDeleteGoal={onDeleteGoal}
              onCloseSearch={onCloseSearch}
            />
          ))}
          {goalJobs.map((job) => (
            <SidebarJobNode
              key={job.id}
              job={job}
              recentRuns={recentRunsByJob.get(job.id) ?? []}
              isSelected={contentView === "job-detail" && selectedJobId === job.id}
              onSelect={() => onSelectJob(job.id)}
              indentLevel={goal.depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

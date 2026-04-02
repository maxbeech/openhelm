import { useState, useRef } from "react";
import { ChevronRight, GripVertical } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { collapseVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
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
  isDragMode: boolean;
  isDragActive: boolean;
  jobDragMode: boolean;
  nestTargetId: string | null;
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
  contentView, selectedGoalId, selectedJobId, isDragMode, isDragActive,
  jobDragMode, nestTargetId, collapsedGoalIds, filteredJobsByGoal,
  onToggleCollapsed, onToggleGoalCollapsed, onSelectGoal, onSelectJob,
  onNewJobForGoal, onNewSubGoal, onMoveToRoot, onArchiveGoal, onDeleteGoal, onCloseSearch,
}: SidebarGoalNodeProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    // Only root goals (depth 0) are reorderable in the outer SortableContext
    id: goal.id, disabled: !isDragMode || goal.depth > 0,
  });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  const indent = goal.depth * 16;

  const [addingJob, setAddingJob] = useState(false);
  const [newJobInput, setNewJobInput] = useState("");
  const jobSubmittingRef = useRef(false);

  const handleSubmitJob = () => {
    if (jobSubmittingRef.current) return;
    const name = newJobInput.trim();
    setNewJobInput("");
    setAddingJob(false);
    if (!name) return;
    jobSubmittingRef.current = true;
    try { onNewJobForGoal(goal.id, name); } finally { jobSubmittingRef.current = false; }
  };

  const isNestTarget = nestTargetId === goal.id;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("group mb-1", isDragging && "opacity-0")}
    >
      <SidebarGoalContextMenu
        goal={goal}
        onNewSubGoal={() => onNewSubGoal(goal.id)}
        onNewJob={() => { onCloseSearch?.(); setAddingJob(true); setNewJobInput(""); }}
        onMoveToRoot={() => onMoveToRoot(goal.id)}
        onArchive={() => onArchiveGoal(goal.id)}
        onDelete={() => onDeleteGoal(goal.id)}
      >
        <div
          className={cn(
            "bg-sidebar pr-3",
            // sticky only when not dragging — CSS transform on dragged parent
            // breaks sticky positioning in WebKit (Tauri WebView)
            !isDragging && "sticky top-[30px] z-10",
            isNestTarget && "ring-2 ring-primary/50 rounded-md",
          )}
          style={{ paddingLeft: `${4 + indent}px` }}
        >
          <div className="flex items-center">
            <span
              {...(isDragMode ? { ...attributes, ...listeners } : {})}
              className={cn(
                "mr-0.5 shrink-0",
                isDragMode
                  ? "cursor-grab text-muted-foreground/40 opacity-0 transition-opacity hover:text-muted-foreground group-hover:opacity-100 active:cursor-grabbing"
                  : "invisible pointer-events-none cursor-default w-0",
              )}
            >
              <GripVertical className="size-3.5" />
            </span>
            <button
              onClick={onToggleCollapsed}
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
                "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm transition-colors",
                isSelected
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50",
              )}
            >
              <NodeIcon icon={goal.icon} defaultIcon="flag" />
              <span className="truncate">{goal.name || goal.description}</span>
            </button>
            <SidebarGoalAddMenu
              onNewSubGoal={() => onNewSubGoal(goal.id)}
              onNewJob={() => { onCloseSearch?.(); setAddingJob(true); setNewJobInput(""); }}
            />
          </div>
        </div>
      </SidebarGoalContextMenu>

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

      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div key="children" variants={collapseVariants} initial="collapsed" animate="expanded" exit="collapsed" style={{ overflow: "hidden" }}>
            {/* Recursive child goals */}
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
                isDragMode={isDragMode}
                isDragActive={isDragActive}
                jobDragMode={jobDragMode}
                nestTargetId={nestTargetId}
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
            {/* Jobs for this goal */}
            <SortableContext items={isDragActive ? goalJobs.map((j) => j.id) : []} strategy={verticalListSortingStrategy}>
              {goalJobs.map((job) => (
                <SidebarJobNode
                  key={job.id}
                  job={job}
                  recentRuns={recentRunsByJob.get(job.id) ?? []}
                  isSelected={contentView === "job-detail" && selectedJobId === job.id}
                  onSelect={() => onSelectJob(job.id)}
                  isDragMode={jobDragMode}
                  indentLevel={goal.depth + 1}
                />
              ))}
            </SortableContext>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

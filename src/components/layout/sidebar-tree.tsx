import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { collapseVariants } from "@/lib/motion";
import { ChevronsDown, ChevronsUp, Folder, FolderOpen, Plus, Search, X } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { useAppStore } from "@/stores/app-store";
import { useGoalStore } from "@/stores/goal-store";
import { useJobStore } from "@/stores/job-store";
import { useRunStore } from "@/stores/run-store";
import { useProjectStore } from "@/stores/project-store";
import * as api from "@/lib/api";
import { SidebarJobNode } from "./sidebar-job-node";
import { SidebarGoalNode } from "./sidebar-goal-node";
import { SortDropdown, applySortGoals, applySortJobs } from "./sidebar-sort";
import { SidebarArchived } from "./sidebar-archived";
import { SidebarProjectGroup } from "./sidebar-project-group";
import { GoalCreationSheet } from "@/components/goals/goal-creation-sheet";
import { cn } from "@/lib/utils";
import { buildGoalTree } from "@/lib/goal-tree";
import type { JobTokenStat } from "@openhelm/shared";

interface SidebarTreeProps {
  projectId: string | null;
  onNewJobForGoal: (goalId: string, initialName: string) => void;
  onNewSubGoal?: (parentGoalId: string) => void;
  onArchiveGoal?: (goalId: string) => void;
  onDeleteGoal?: (goalId: string) => void;
}

export function SidebarTree({ projectId, onNewJobForGoal, onNewSubGoal, onArchiveGoal, onDeleteGoal }: SidebarTreeProps) {
  const {
    contentView,
    selectedGoalId,
    selectedJobId,
    collapsedGoalIds,
    collapsedProjectIds,
    selectGoal,
    selectJob,
    toggleGoalCollapsed,
    toggleProjectCollapsed,
    goalSortMode,
    jobSortMode,
    setGoalSortMode,
    setJobSortMode,
    groupByProject,
    setGroupByProject,
    sidebarSearch,
    setSidebarSearch,
    projectGroupOrder,
    setProjectGroupOrder,
    setCollapsedGoalIds,
  } = useAppStore();
  const { goals, createGoal, reorderGoalsOptimistic } = useGoalStore();
  const { jobs, reorderJobsOptimistic } = useJobStore();
  const { runs } = useRunStore();
  const { projects } = useProjectStore();

  const [addingGoal, setAddingGoal] = useState(false);
  const [newGoalInput, setNewGoalInput] = useState("");
  // Ref guard prevents the onKeyDown(Enter) + onBlur double-fire from
  // submitting the goal creation form twice in the same event cycle.
  const goalCreatingRef = useRef(false);
  const [pendingSubGoalParentId, setPendingSubGoalParentId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  // Tracks whether a dnd-kit drag gesture is currently in progress.
  // SortableContext items are only populated during active drag to prevent
  // dnd-kit from applying layout-shift transforms during search filtering.
  const [isDragActive, setIsDragActive] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [tokenStats, setTokenStats] = useState<JobTokenStat[]>([]);

  // ─── Token stats ─────────────────────────────────────────────────────────

  useEffect(() => {
    api.getJobTokenStats({}).then(setTokenStats).catch(() => {});
  }, [runs]); // refresh when runs change

  const tokensByJob = useMemo(() => {
    const map = new Map<string, number>();
    for (const stat of tokenStats) {
      map.set(stat.jobId, stat.totalInputTokens + stat.totalOutputTokens);
    }
    return map;
  }, [tokenStats]);

  const tokensByGoal = useMemo(() => {
    const map = new Map<string, number>();
    for (const job of jobs) {
      if (!job.goalId) continue;
      const t = tokensByJob.get(job.id) ?? 0;
      map.set(job.goalId, (map.get(job.goalId) ?? 0) + t);
    }
    return map;
  }, [jobs, tokensByJob]);

  const tokensByProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const job of jobs) {
      const t = tokensByJob.get(job.id) ?? 0;
      map.set(job.projectId, (map.get(job.projectId) ?? 0) + t);
    }
    return map;
  }, [jobs, tokensByJob]);

  // ─── DnD sensors ─────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const goalDragMode = goalSortMode === "custom" && !sidebarSearch;
  // Job drag tied to goal sort mode — the single sort dropdown in the GOALS header controls both
  const jobDragMode = goalSortMode === "custom" && !sidebarSearch;

  // ─── Search toggle ────────────────────────────────────────────────────────

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSidebarSearch("");
  }, [setSidebarSearch]);

  // ─── Core data derivations ────────────────────────────────────────────────

  const activeGoals = useMemo(
    () => applySortGoals(
      goals.filter((g) => g.status !== "archived"),
      goalSortMode,
      tokensByGoal,
    ),
    [goals, goalSortMode, tokensByGoal],
  );

  // Build goal tree for hierarchical sidebar rendering
  const goalTree = useMemo(() => buildGoalTree(activeGoals), [activeGoals]);

  // Hierarchy actions
  const handleMoveToRoot = useCallback((goalId: string) => {
    api.updateGoal({ id: goalId, parentId: null }).catch(() => {});
  }, []);

  const handleNestGoal = useCallback((goalId: string, newParentId: string) => {
    api.updateGoal({ id: goalId, parentId: newParentId }).catch(() => {});
  }, []);

  const handleUnnestGoal = useCallback((goalId: string, currentParentId: string) => {
    const parent = goals.find((g) => g.id === currentParentId);
    api.updateGoal({ id: goalId, parentId: parent?.parentId ?? null }).catch(() => {});
  }, [goals]);

  // Collapse-all: true when every active goal is in the collapsed list
  const allGoalsCollapsed =
    activeGoals.length > 0 &&
    activeGoals.every((g) => collapsedGoalIds.includes(g.id));

  const jobsByGoal = useMemo(() => {
    const map = new Map<string | null, typeof jobs>();
    for (const job of jobs) {
      if (job.isArchived) continue;
      // Hide internal sentinel jobs (e.g. health monitoring) from sidebar
      if (job.systemCategory === "health_monitoring") continue;
      const key = job.goalId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(job);
    }
    for (const [key, groupJobs] of map) {
      map.set(key, applySortJobs(groupJobs, jobSortMode, tokensByJob));
    }
    return map;
  }, [jobs, jobSortMode, tokensByJob]);

  const standaloneJobs = useMemo(
    () => jobsByGoal.get(null) ?? [],
    [jobsByGoal],
  );

  const archivedGoals = useMemo(
    () => goals.filter((g) => g.status === "archived"),
    [goals],
  );

  const archivedStandaloneJobs = useMemo(
    () => jobs.filter((j) => j.isArchived && !j.goalId),
    [jobs],
  );

  const archivedJobsByGoal = useMemo(() => {
    const map = new Map<string, typeof jobs>();
    for (const job of jobs) {
      if (!job.isArchived || !job.goalId) continue;
      if (!map.has(job.goalId)) map.set(job.goalId, []);
      map.get(job.goalId)!.push(job);
    }
    return map;
  }, [jobs]);

  const hasArchived = archivedGoals.length > 0 || archivedStandaloneJobs.length > 0;
  const archivedCount = archivedGoals.length + archivedStandaloneJobs.length;

  const recentRunsByJob = useMemo(() => {
    const map = new Map<string, typeof runs>();
    for (const run of runs) {
      let arr = map.get(run.jobId);
      if (!arr) {
        arr = [];
        map.set(run.jobId, arr);
      }
      if (arr.length < 5) arr.push(run);
    }
    return map;
  }, [runs]);

  // ─── Search filtering ─────────────────────────────────────────────────────

  const q = sidebarSearch.toLowerCase().trim();

  const filteredGoals = useMemo(() => {
    if (!q) return activeGoals;
    return activeGoals.filter((goal) => {
      if ((goal.name || goal.description).toLowerCase().includes(q)) return true;
      const goalJobs = jobsByGoal.get(goal.id) ?? [];
      return goalJobs.some((j) => j.name.toLowerCase().includes(q));
    });
  }, [activeGoals, jobsByGoal, q]);

  const filteredStandaloneJobs = useMemo(() => {
    if (!q) return standaloneJobs;
    return standaloneJobs.filter((j) => j.name.toLowerCase().includes(q));
  }, [standaloneJobs, q]);

  // Jobs within each goal — filtered by search query when active.
  // If the goal name itself matches, show all its jobs; otherwise show only matching jobs.
  const filteredJobsByGoal = useMemo(() => {
    if (!q) return jobsByGoal;
    const map = new Map<string | null, typeof jobs>();
    for (const [goalId, goalJobs] of jobsByGoal) {
      if (goalId !== null) {
        const goal = activeGoals.find((g) => g.id === goalId);
        const goalNameMatch = goal && (goal.name || goal.description).toLowerCase().includes(q);
        map.set(goalId, goalNameMatch ? goalJobs : goalJobs.filter((j) => j.name.toLowerCase().includes(q)));
      } else {
        map.set(null, goalJobs.filter((j) => j.name.toLowerCase().includes(q)));
      }
    }
    return map;
  }, [jobsByGoal, q, activeGoals]);

  // ─── Project grouping ─────────────────────────────────────────────────────

  const isAllProjects = projectId === null;
  const showGroupToggle = isAllProjects;

  // Ordered project list for grouped view
  const orderedProjects = useMemo(() => {
    if (!isAllProjects || !groupByProject) return [];
    // Sort projects by sort mode first
    let sorted = [...projects];
    if (goalSortMode === "alpha_asc") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (goalSortMode === "alpha_desc") sorted.sort((a, b) => b.name.localeCompare(a.name));
    else if (goalSortMode === "created_asc") sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    else if (goalSortMode === "created_desc") sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else if (goalSortMode === "updated_asc") sorted.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    else if (goalSortMode === "updated_desc") sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    else if (goalSortMode === "tokens_asc") sorted.sort((a, b) => (tokensByProject.get(a.id) ?? 0) - (tokensByProject.get(b.id) ?? 0));
    else if (goalSortMode === "tokens_desc") sorted.sort((a, b) => (tokensByProject.get(b.id) ?? 0) - (tokensByProject.get(a.id) ?? 0));
    else if (goalSortMode === "custom" && projectGroupOrder.length > 0) {
      // Apply persisted custom order
      const orderMap = new Map(projectGroupOrder.map((id, i) => [id, i]));
      sorted.sort((a, b) => (orderMap.get(a.id) ?? 9999) - (orderMap.get(b.id) ?? 9999));
    }
    return sorted;
  }, [projects, isAllProjects, groupByProject, goalSortMode, tokensByProject, projectGroupOrder]);

  // Filter projects for search
  const visibleProjects = useMemo(() => {
    if (!q) return orderedProjects;
    return orderedProjects.filter((p) => {
      if (p.name.toLowerCase().includes(q)) return true;
      const pGoals = activeGoals.filter((g) => g.projectId === p.id);
      if (pGoals.some((g) => {
        if ((g.name || g.description).toLowerCase().includes(q)) return true;
        return (jobsByGoal.get(g.id) ?? []).some((j) => j.name.toLowerCase().includes(q));
      })) return true;
      const pStandalone = standaloneJobs.filter((j) => j.projectId === p.id);
      return pStandalone.some((j) => j.name.toLowerCase().includes(q));
    });
  }, [orderedProjects, q, activeGoals, jobsByGoal, standaloneJobs]);

  // ─── Goal creation ────────────────────────────────────────────────────────

  const handleCreateGoal = async () => {
    if (goalCreatingRef.current) return;
    const name = newGoalInput.trim();
    setNewGoalInput("");
    setAddingGoal(false);
    if (!name || !projectId) return;
    goalCreatingRef.current = true;
    try {
      const goal = await createGoal({ projectId, name });
      selectGoal(goal.id);
    } catch {
      // goal-store sets error state
    } finally {
      goalCreatingRef.current = false;
    }
  };

  // ─── Drag handlers ────────────────────────────────────────────────────────

  // Unified handler for DndContexts that contain both goals and their nested
  // jobs. Detects whether the dragged item is a goal or a job and handles both.
  const handleContextDragEnd = useCallback((event: DragEndEvent, scopeGoals: typeof activeGoals) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // Goal drag?
    const goalOldIndex = scopeGoals.findIndex((g) => g.id === active.id);
    if (goalOldIndex !== -1) {
      const goalNewIndex = scopeGoals.findIndex((g) => g.id === over.id);
      if (goalNewIndex === -1) return;
      const reordered = arrayMove(scopeGoals, goalOldIndex, goalNewIndex);
      flushSync(() => reorderGoalsOptimistic(reordered.map((g) => g.id)));
      api.reorderGoals({ items: reordered.map((g, i) => ({ id: g.id, sortOrder: i })) }).catch(() => {});
      return;
    }

    // Job drag within a goal? Find the goal that owns it.
    for (const goal of scopeGoals) {
      const goalJobs = filteredJobsByGoal.get(goal.id) ?? [];
      const jobOldIndex = goalJobs.findIndex((j) => j.id === active.id);
      if (jobOldIndex === -1) continue;
      const jobNewIndex = goalJobs.findIndex((j) => j.id === over.id);
      if (jobNewIndex === -1) return; // cross-goal drag not allowed
      const reordered = arrayMove(goalJobs, jobOldIndex, jobNewIndex);
      flushSync(() => reorderJobsOptimistic(reordered.map((j) => j.id)));
      api.reorderJobs({ items: reordered.map((j, i) => ({ id: j.id, sortOrder: i })) }).catch(() => {});
      return;
    }
  }, [reorderGoalsOptimistic, reorderJobsOptimistic, filteredJobsByGoal]);

  const handleStandaloneJobDragEnd = useCallback((event: DragEndEvent, scopeJobs: typeof standaloneJobs) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = scopeJobs.findIndex((j) => j.id === active.id);
    const newIndex = scopeJobs.findIndex((j) => j.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(scopeJobs, oldIndex, newIndex);
    flushSync(() => reorderJobsOptimistic(reordered.map((j) => j.id)));
    api.reorderJobs({ items: reordered.map((j, i) => ({ id: j.id, sortOrder: i })) }).catch(() => {});
  }, [reorderJobsOptimistic]);

  const handleProjectGroupDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = orderedProjects.map((p) => p.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    setProjectGroupOrder(arrayMove(ids, oldIndex, newIndex));
  }, [orderedProjects, setProjectGroupOrder]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-auto">
      {/* GOALS section header */}
      <div className="sticky top-0 z-20 flex h-[30px] items-center gap-1 bg-sidebar px-3">
        <span className="flex-1 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
          Goals
        </span>
        {showGroupToggle && (
          <button
            onClick={() => setGroupByProject(!groupByProject)}
            className={cn(
              "rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
              groupByProject && "text-primary",
            )}
            title={groupByProject ? "Ungroup by project" : "Group by project"}
          >
            {groupByProject ? <FolderOpen className="size-3.5" /> : <Folder className="size-3.5" />}
          </button>
        )}
        {activeGoals.length > 0 && (
          <button
            onClick={() =>
              setCollapsedGoalIds(
                allGoalsCollapsed ? [] : activeGoals.map((g) => g.id),
              )
            }
            className="rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            title={allGoalsCollapsed ? "Expand all goals" : "Collapse all goals"}
          >
            {allGoalsCollapsed ? (
              <ChevronsUp className="size-3.5" />
            ) : (
              <ChevronsDown className="size-3.5" />
            )}
          </button>
        )}
        <SortDropdown value={goalSortMode} onChange={setGoalSortMode} label="goals" />
        <button
          onClick={searchOpen ? closeSearch : openSearch}
          className={cn(
            "rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
            (searchOpen || sidebarSearch) && "text-primary",
          )}
          title="Search goals and jobs"
        >
          <Search className="size-3.5" />
        </button>
        {projectId && (
          <button
            onClick={() => {
              if (searchOpen) closeSearch();
              setAddingGoal(true);
              setNewGoalInput("");
            }}
            className="rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            title="New goal"
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>

      {/* Search input */}
      <AnimatePresence>
        {searchOpen && (
          <motion.div
            key="search"
            variants={collapseVariants}
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            style={{ overflow: "hidden" }}
          >
            <div className="flex items-center gap-1 px-3 pb-1">
              <input
                ref={searchInputRef}
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") closeSearch();
                }}
                placeholder="Search..."
                className="flex-1 rounded-md bg-sidebar-accent px-2 py-1 text-sm text-sidebar-foreground outline-none ring-1 ring-primary/50"
              />
              <button
                onClick={closeSearch}
                className="rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Inline goal name input */}
      <AnimatePresence>
        {addingGoal && (
          <motion.div
            key="add-goal"
            variants={collapseVariants}
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            style={{ overflow: "hidden" }}
          >
            <div className="flex items-center gap-1 px-3 pb-1">
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
                className="flex-1 rounded-md bg-sidebar-accent px-2 py-1 text-sm text-sidebar-foreground outline-none ring-1 ring-primary/50"
              />
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setNewGoalInput("");
                  setAddingGoal(false);
                }}
                className="rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                title="Cancel"
              >
                <X className="size-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── GROUPED VIEW (All Projects + groupByProject=true) ── */}
      {isAllProjects && groupByProject ? (
        <div className="pb-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={() => setIsDragActive(true)}
            onDragEnd={(e) => { setIsDragActive(false); if (goalDragMode) handleProjectGroupDragEnd(e); }}
            onDragCancel={() => setIsDragActive(false)}
          >
            <SortableContext
              items={isDragActive ? visibleProjects.map((p) => p.id) : []} // Only register during active drag — prevents dnd-kit layout shifts during search filtering
              strategy={verticalListSortingStrategy}
            >
              {visibleProjects.map((project) => {
                const projectGoals = filteredGoals.filter((g) => g.projectId === project.id);
                const projectStandalone = filteredStandaloneJobs.filter((j) => j.projectId === project.id);
                return (
                  <DndContext
                    key={project.id}
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={() => setIsDragActive(true)}
                    onDragEnd={(e) => { setIsDragActive(false); handleContextDragEnd(e, projectGoals); }}
                    onDragCancel={() => setIsDragActive(false)}
                  >
                    <SidebarProjectGroup
                      project={project}
                      goals={projectGoals}
                      standaloneJobs={projectStandalone}
                      jobsByGoal={filteredJobsByGoal}
                      recentRunsByJob={recentRunsByJob}
                      contentView={contentView}
                      selectedGoalId={selectedGoalId}
                      selectedJobId={selectedJobId}
                      collapsedGoalIds={collapsedGoalIds}
                      isCollapsed={collapsedProjectIds.includes(project.id)}
                      isDragMode={goalDragMode}
                      isDragActive={isDragActive}
                      onSelectGoal={selectGoal}
                      onSelectJob={selectJob}
                      onToggleGoalCollapsed={toggleGoalCollapsed}
                      onToggleCollapsed={() => toggleProjectCollapsed(project.id)}
                      onNewJobForGoal={onNewJobForGoal}
                      onCloseSearch={closeSearch}
                      jobDragMode={jobDragMode}
                    />
                  </DndContext>
                );
              })}
            </SortableContext>
          </DndContext>

          {hasArchived && (
            <SidebarArchived
              archivedGoals={archivedGoals}
              archivedStandaloneJobs={archivedStandaloneJobs}
              archivedJobsByGoal={archivedJobsByGoal}
              recentRunsByJob={recentRunsByJob}
              contentView={contentView}
              selectedGoalId={selectedGoalId}
              selectedJobId={selectedJobId}
              selectGoal={selectGoal}
              selectJob={selectJob}
              archivedCount={archivedCount}
            />
          )}
        </div>
      ) : (
        /* ── FLAT VIEW ── */
        <div className="pb-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={() => setIsDragActive(true)}
            onDragEnd={(e) => { setIsDragActive(false); handleContextDragEnd(e, filteredGoals); }}
            onDragCancel={() => setIsDragActive(false)}
          >
            <SortableContext
              items={isDragActive ? filteredGoals.map((g) => g.id) : []} // Only register during active drag — prevents dnd-kit layout shifts during search filtering
              strategy={verticalListSortingStrategy}
            >
              {goalTree.map((node) => (
                <SidebarGoalNode
                  key={node.id}
                  goal={node}
                  goalJobs={filteredJobsByGoal.get(node.id) ?? []}
                  recentRunsByJob={recentRunsByJob}
                  isCollapsed={collapsedGoalIds.includes(node.id)}
                  isSelected={contentView === "goal-detail" && selectedGoalId === node.id}
                  contentView={contentView}
                  selectedGoalId={selectedGoalId}
                  selectedJobId={selectedJobId}
                  isDragMode={goalDragMode}
                  isDragActive={isDragActive}
                  jobDragMode={jobDragMode}
                  nestTargetId={null}
                  collapsedGoalIds={collapsedGoalIds}
                  filteredJobsByGoal={filteredJobsByGoal}
                  onToggleCollapsed={() => toggleGoalCollapsed(node.id)}
                  onToggleGoalCollapsed={toggleGoalCollapsed}
                  onSelectGoal={selectGoal}
                  onSelectJob={selectJob}
                  onNewJobForGoal={onNewJobForGoal}
                  onNewSubGoal={onNewSubGoal ?? ((parentGoalId) => setPendingSubGoalParentId(parentGoalId))}
                  onMoveToRoot={handleMoveToRoot}
                  onArchiveGoal={onArchiveGoal ?? (() => {})}
                  onDeleteGoal={onDeleteGoal ?? (() => {})}
                  onCloseSearch={closeSearch}
                />
              ))}
            </SortableContext>
          </DndContext>

          {/* Standalone jobs (no goal) */}
          {filteredStandaloneJobs.length > 0 && (
            <div className="mt-3 border-t border-sidebar-border pt-3">
              <div className="mb-1 flex items-center gap-1 px-3">
                <p className="flex-1 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Jobs
                </p>
                <SortDropdown value={jobSortMode} onChange={setJobSortMode} label="jobs" />
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={() => setIsDragActive(true)}
                onDragEnd={(e) => { setIsDragActive(false); handleStandaloneJobDragEnd(e, filteredStandaloneJobs); }}
                onDragCancel={() => setIsDragActive(false)}
              >
                <SortableContext
                  items={isDragActive ? filteredStandaloneJobs.map((j) => j.id) : []} // Only register during active drag — prevents dnd-kit layout shifts during search filtering
                  strategy={verticalListSortingStrategy}
                >
                  {filteredStandaloneJobs.map((job) => (
                    <SidebarJobNode
                      key={job.id}
                      job={job}
                      recentRuns={recentRunsByJob.get(job.id) ?? []}
                      isSelected={contentView === "job-detail" && selectedJobId === job.id}
                      onSelect={() => selectJob(job.id)}
                      isDragMode={jobDragMode}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          )}

          {/* Archived section */}
          {hasArchived && (
            <SidebarArchived
              archivedGoals={archivedGoals}
              archivedStandaloneJobs={archivedStandaloneJobs}
              archivedJobsByGoal={archivedJobsByGoal}
              recentRunsByJob={recentRunsByJob}
              contentView={contentView}
              selectedGoalId={selectedGoalId}
              selectedJobId={selectedJobId}
              selectGoal={selectGoal}
              selectJob={selectJob}
              archivedCount={archivedCount}
            />
          )}
        </div>
      )}

      {projectId && pendingSubGoalParentId && (
        <GoalCreationSheet
          open={true}
          onOpenChange={(open) => { if (!open) setPendingSubGoalParentId(null); }}
          projectId={projectId}
          parentGoalId={pendingSubGoalParentId}
          onComplete={() => setPendingSubGoalParentId(null)}
        />
      )}
    </div>
  );
}

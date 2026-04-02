import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { collapseVariants } from "@/lib/motion";
import { ChevronsDown, ChevronsUp, Folder, FolderOpen, Plus, Search, X } from "lucide-react";
import { OpenHelmIcon } from "@/components/shared/openhelm-icon";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverEvent,
  DragOverlay,
  useDroppable,
} from "@dnd-kit/core";
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
import { NodeIcon } from "@/components/shared/node-icon";
import { cn } from "@/lib/utils";
import { buildGoalTree, canNestUnder } from "@/lib/goal-tree";
import type { JobTokenStat } from "@openhelm/shared";

/** Drop zone above the goal list — dropping a goal here moves it to root level */
function RootDropZone({ isActive, isDraggingGoal }: { isActive: boolean; isDraggingGoal: boolean }) {
  const { setNodeRef } = useDroppable({
    id: "drop-__root__",
    data: { type: "root" },
  });
  // Only show when dragging a goal (not a job)
  if (!isDraggingGoal) return null;
  return (
    <div ref={setNodeRef} className="px-3 py-1">
      {isActive && (
        <div className="py-px" style={{ paddingRight: 12 }}>
          <div className="h-0.5 rounded-full bg-primary" />
        </div>
      )}
      {!isActive && <div className="h-1" />}
    </div>
  );
}

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
  const { goals, createGoal, archiveGoal: storeArchiveGoal, deleteGoal: storeDeleteGoal } = useGoalStore();
  const { jobs } = useJobStore();
  const { runs } = useRunStore();
  const { projects } = useProjectStore();

  const [addingGoal, setAddingGoal] = useState(false);
  const [newGoalInput, setNewGoalInput] = useState("");
  const goalCreatingRef = useRef(false);
  const [pendingSubGoalParentId, setPendingSubGoalParentId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [showSystemItems, setShowSystemItems] = useState(false);

  // Load system items visibility from settings
  useEffect(() => {
    api.getSetting("show_system_items" as any).then((s) => {
      if (s?.value === "true") setShowSystemItems(true);
    }).catch(() => {});
  }, []);
  const [tokenStats, setTokenStats] = useState<JobTokenStat[]>([]);

  // ─── Drag state for reparenting ──────────────────────────────────────────
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [activeDragType, setActiveDragType] = useState<"goal" | "job" | null>(null);
  const [dropTargetGoalId, setDropTargetGoalId] = useState<string | null>(null);

  // ─── Token stats ─────────────────────────────────────────────────────────

  useEffect(() => {
    api.getJobTokenStats({}).then(setTokenStats).catch(() => {});
  }, [runs]);

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

  // The item being dragged — used by the DragOverlay
  const activeDragGoal = useMemo(
    () => (activeDragId && activeDragType === "goal" ? goals.find((g) => g.id === activeDragId) ?? null : null),
    [activeDragId, activeDragType, goals],
  );
  const activeDragJob = useMemo(
    () => (activeDragId && activeDragType === "job" ? jobs.find((j) => j.id === activeDragId) ?? null : null),
    [activeDragId, activeDragType, jobs],
  );

  // ─── DnD sensors ─────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // ─── Search toggle ────────────────────────────────────────────────────────

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSidebarSearch("");
  }, [setSidebarSearch]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    const thumb = thumbRef.current;
    if (!el || !thumb) return;

    // Position the custom thumb
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight) {
      thumb.style.opacity = "0";
      return;
    }
    const thumbH = Math.max(24, (clientHeight / scrollHeight) * clientHeight);
    const maxTop = clientHeight - thumbH;
    const clampedScroll = Math.max(0, Math.min(scrollTop, scrollHeight - clientHeight));
    const thumbTop = (clampedScroll / (scrollHeight - clientHeight)) * maxTop;
    thumb.style.height = `${thumbH}px`;
    thumb.style.transform = `translateY(${thumbTop}px)`;
    thumb.style.opacity = "1";

    // Hide after 1 s of inactivity
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      if (thumbRef.current) thumbRef.current.style.opacity = "0";
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, []);

  // ─── Core data derivations ────────────────────────────────────────────────

  const activeGoals = useMemo(
    () => applySortGoals(
      goals.filter((g) => g.status !== "archived" && (showSystemItems || !g.isSystem)),
      goalSortMode,
      tokensByGoal,
    ),
    [goals, goalSortMode, tokensByGoal, showSystemItems],
  );

  const goalTree = useMemo(() => buildGoalTree(activeGoals), [activeGoals]);

  // Hierarchy actions
  const handleMoveToRoot = useCallback((goalId: string) => {
    // Instant optimistic update + API persist
    useGoalStore.setState((s) => ({
      goals: s.goals.map((g) => g.id === goalId ? { ...g, parentId: null } : g),
    }));
    api.updateGoal({ id: goalId, parentId: null }).catch(() => {});
  }, []);

  const handleArchiveGoal = useCallback((goalId: string) => {
    storeArchiveGoal(goalId).catch(() => {});
  }, [storeArchiveGoal]);

  const handleDeleteGoal = useCallback((goalId: string) => {
    storeDeleteGoal(goalId).catch(() => {});
  }, [storeDeleteGoal]);

  // Collapse-all: true when every active goal is in the collapsed list
  const allGoalsCollapsed =
    activeGoals.length > 0 &&
    activeGoals.every((g) => collapsedGoalIds.includes(g.id));

  const jobsByGoal = useMemo(() => {
    const map = new Map<string | null, typeof jobs>();
    for (const job of jobs) {
      if (job.isArchived) continue;
      if (job.systemCategory === "health_monitoring") continue;
      // Hide system jobs when toggle is off
      if (!showSystemItems && job.source === "system") continue;
      const key = job.goalId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(job);
    }
    for (const [key, groupJobs] of map) {
      map.set(key, applySortJobs(groupJobs, jobSortMode, tokensByJob));
    }
    return map;
  }, [jobs, jobSortMode, tokensByJob, showSystemItems]);

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

  const orderedProjects = useMemo(() => {
    if (!isAllProjects || !groupByProject) return [];
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
      const orderMap = new Map(projectGroupOrder.map((id, i) => [id, i]));
      sorted.sort((a, b) => (orderMap.get(a.id) ?? 9999) - (orderMap.get(b.id) ?? 9999));
    }
    return sorted;
  }, [projects, isAllProjects, groupByProject, goalSortMode, tokensByProject, projectGroupOrder]);

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

  // ─── Reparenting drag handlers ────────────────────────────────────────────

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const data = active.data.current as { type: "goal" | "job" } | undefined;
    setActiveDragId(String(active.id));
    setActiveDragType(data?.type ?? "goal");
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    if (!over) {
      setDropTargetGoalId(null);
      return;
    }
    const overData = over.data.current as { type?: string; goalId?: string } | undefined;
    if (overData?.type === "root") {
      // Hovering the root drop zone — signal with special "__root__" marker
      setDropTargetGoalId("__root__");
    } else if (overData?.type === "goal") {
      const targetGoal = activeGoals.find((g) => g.id === overData.goalId);
      // Prevent dropping onto system goals
      setDropTargetGoalId(targetGoal?.isSystem ? null : (overData.goalId ?? null));
    } else {
      setDropTargetGoalId(null);
    }
  }, []);

  // Optimistic helpers: update store immediately for instant UI, then persist via API
  const optimisticMoveGoal = useCallback((goalId: string, newParentId: string | null) => {
    // Instant store update for snappy UI
    useGoalStore.setState((s) => ({
      goals: s.goals.map((g) => g.id === goalId ? { ...g, parentId: newParentId } : g),
    }));
    // Persist to backend (store's updateGoal also updates store on response, which is fine)
    api.updateGoal({ id: goalId, parentId: newParentId }).catch(() => {});
  }, []);

  const optimisticMoveJob = useCallback((jobId: string, newGoalId: string | null) => {
    useJobStore.setState((s) => ({
      jobs: s.jobs.map((j) => j.id === jobId ? { ...j, goalId: newGoalId } : j),
    }));
    api.updateJob({ id: jobId, goalId: newGoalId }).catch(() => {});
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    const dragId = String(active.id);
    const dragData = active.data.current as { type: "goal" | "job" } | undefined;
    const dragType = dragData?.type ?? "goal";

    const overData = over?.data.current as { type?: string; goalId?: string } | undefined;
    const isRootDrop = overData?.type === "root";
    const targetGoalId = overData?.type === "goal" ? (overData.goalId ?? null) : null;

    // Reset drag state
    setActiveDragId(null);
    setActiveDragType(null);
    setDropTargetGoalId(null);

    // Dropped on the root zone or in empty space — move to root/standalone
    if (!over || isRootDrop) {
      if (dragType === "goal") {
        const goal = goals.find((g) => g.id === dragId);
        if (goal?.parentId) optimisticMoveGoal(dragId, null);
      }
      // Jobs dropped on root or empty space: no-op (jobs must stay under a goal)
      return;
    }

    // Dropped on self — no-op
    if (targetGoalId === dragId) return;

    if (dragType === "goal" && targetGoalId) {
      if (!canNestUnder(dragId, targetGoalId, goals)) return;
      const goal = goals.find((g) => g.id === dragId);
      if (goal?.parentId === targetGoalId) return;
      const targetGoal = goals.find((g) => g.id === targetGoalId);
      if (targetGoal?.isSystem) return; // cannot nest under system goal
      optimisticMoveGoal(dragId, targetGoalId);
    } else if (dragType === "job" && targetGoalId) {
      const job = jobs.find((j) => j.id === dragId);
      if (job?.goalId === targetGoalId) return;
      const targetGoal = goals.find((g) => g.id === targetGoalId);
      if (targetGoal?.isSystem) return; // cannot move jobs into system goal
      optimisticMoveJob(dragId, targetGoalId);
    }
  }, [goals, jobs, optimisticMoveGoal, optimisticMoveJob]);

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
    setActiveDragType(null);
    setDropTargetGoalId(null);
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 flex-col">
      {/* GOALS section header — fixed above scroll area */}
      <div className="flex h-[30px] shrink-0 items-center gap-1 bg-sidebar px-3">
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
          onClick={() => {
            const next = !showSystemItems;
            setShowSystemItems(next);
            api.setSetting({ key: "show_system_items" as any, value: String(next) }).catch(() => {});
          }}
          className={cn(
            "rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
            showSystemItems && "text-primary",
          )}
          title={showSystemItems ? "Hide system items" : "Show system items"}
        >
          <OpenHelmIcon className="size-3.5" />
        </button>
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
            className="shrink-0"
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
            className="shrink-0"
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

      {/* Scrollable tree area */}
      <div className="relative flex-1">
      {/* Custom scrollbar thumb — outside the scroll container so it stays fixed */}
      <div
        ref={thumbRef}
        className="pointer-events-none absolute right-0 top-0 z-50 w-[6px] rounded-full opacity-0 transition-opacity duration-300"
        style={{ background: "var(--color-border)" }}
      />
      <div ref={scrollRef} onScroll={handleScroll} className="absolute inset-0 sidebar-scroll pr-[6px]">

      {/* ── GROUPED VIEW (All Projects + groupByProject=true) ── */}
      {isAllProjects && groupByProject ? (
        <div className="pb-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <RootDropZone
              isActive={dropTargetGoalId === "__root__"}
              isDraggingGoal={activeDragType === "goal" && !!activeDragId}
            />
            {visibleProjects.map((project) => {
              const projectGoals = filteredGoals.filter((g) => g.projectId === project.id);
              const projectStandalone = filteredStandaloneJobs.filter((j) => j.projectId === project.id);
              return (
                <SidebarProjectGroup
                  key={project.id}
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
                  dropTargetGoalId={dropTargetGoalId}
                  activeDragId={activeDragId}
                  onSelectGoal={selectGoal}
                  onSelectJob={selectJob}
                  onToggleGoalCollapsed={toggleGoalCollapsed}
                  onToggleCollapsed={() => toggleProjectCollapsed(project.id)}
                  onNewJobForGoal={onNewJobForGoal}
                  onMoveToRoot={handleMoveToRoot}
                  onArchiveGoal={onArchiveGoal ?? handleArchiveGoal}
                  onDeleteGoal={onDeleteGoal ?? handleDeleteGoal}
                  onCloseSearch={closeSearch}
                />
              );
            })}

            <DragOverlay dropAnimation={null}>
              {activeDragGoal && (
                <div className="flex items-center gap-1.5 rounded-md border border-sidebar-border bg-sidebar px-2 py-1 shadow-lg text-sm text-sidebar-foreground">
                  <NodeIcon icon={activeDragGoal.icon} defaultIcon="flag" variant="goal" />
                  <span className="truncate">{activeDragGoal.name || activeDragGoal.description}</span>
                </div>
              )}
              {activeDragJob && (
                <div className="flex items-center gap-1.5 rounded-md border border-sidebar-border bg-sidebar px-2 py-1 shadow-lg text-sm text-sidebar-foreground">
                  <NodeIcon icon={activeDragJob.icon} defaultIcon="briefcase" />
                  <span className="truncate">{activeDragJob.name}</span>
                </div>
              )}
            </DragOverlay>
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
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            {/* Root drop zone — goals dragged here become top-level */}
            <RootDropZone
              isActive={dropTargetGoalId === "__root__"}
              isDraggingGoal={activeDragType === "goal" && !!activeDragId}
            />

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
                dropTargetGoalId={dropTargetGoalId}
                activeDragId={activeDragId}
                collapsedGoalIds={collapsedGoalIds}
                filteredJobsByGoal={filteredJobsByGoal}
                onToggleCollapsed={() => toggleGoalCollapsed(node.id)}
                onToggleGoalCollapsed={toggleGoalCollapsed}
                onSelectGoal={selectGoal}
                onSelectJob={selectJob}
                onNewJobForGoal={onNewJobForGoal}
                onNewSubGoal={onNewSubGoal ?? ((parentGoalId) => setPendingSubGoalParentId(parentGoalId))}
                onMoveToRoot={handleMoveToRoot}
                onArchiveGoal={onArchiveGoal ?? handleArchiveGoal}
                onDeleteGoal={onDeleteGoal ?? handleDeleteGoal}
                onCloseSearch={closeSearch}
              />
            ))}

            {/* Standalone jobs (no goal) */}
            {filteredStandaloneJobs.length > 0 && (
              <div className="mt-3 border-t border-sidebar-border pt-3">
                <div className="mb-1 flex items-center gap-1 px-3">
                  <p className="flex-1 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Jobs
                  </p>
                  <SortDropdown value={jobSortMode} onChange={setJobSortMode} label="jobs" />
                </div>
                {filteredStandaloneJobs.map((job) => (
                  <SidebarJobNode
                    key={job.id}
                    job={job}
                    recentRuns={recentRunsByJob.get(job.id) ?? []}
                    isSelected={contentView === "job-detail" && selectedJobId === job.id}
                    onSelect={() => selectJob(job.id)}
                  />
                ))}
              </div>
            )}

            {/* DragOverlay renders a compact card following the cursor */}
            <DragOverlay dropAnimation={null}>
              {activeDragGoal && (
                <div className="flex items-center gap-1.5 rounded-md border border-sidebar-border bg-sidebar px-2 py-1 shadow-lg text-sm text-sidebar-foreground">
                  <NodeIcon icon={activeDragGoal.icon} defaultIcon="flag" variant="goal" />
                  <span className="truncate">{activeDragGoal.name || activeDragGoal.description}</span>
                </div>
              )}
              {activeDragJob && (
                <div className="flex items-center gap-1.5 rounded-md border border-sidebar-border bg-sidebar px-2 py-1 shadow-lg text-sm text-sidebar-foreground">
                  <NodeIcon icon={activeDragJob.icon} defaultIcon="briefcase" />
                  <span className="truncate">{activeDragJob.name}</span>
                </div>
              )}
            </DragOverlay>
          </DndContext>

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
    </div>
    </div>
  );
}

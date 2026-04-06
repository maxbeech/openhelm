import { useEffect, useMemo, useState, useCallback } from "react";
import { Target as TargetIcon, BarChart3, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGoalStore } from "@/stores/goal-store";
import { useProjectStore } from "@/stores/project-store";
import { useAppStore } from "@/stores/app-store";
import { VisualizationList } from "@/components/visualizations/visualization-list";
import { TargetProgressBar } from "@/components/targets/target-progress-bar";
import * as api from "@/lib/api";
import type { Target, TargetEvaluation } from "@openhelm/shared";
import { useAgentEvent } from "@/hooks/use-agent-event";

interface Props {
  collapsed?: boolean;
  onToggle?: () => void;
}

export function DashboardInsightsSection({ collapsed = false, onToggle }: Props) {
  const { goals } = useGoalStore();
  const { projects } = useProjectStore();
  const { activeProjectId } = useAppStore();

  const [targets, setTargets] = useState<Target[]>([]);
  const [evaluations, setEvaluations] = useState<TargetEvaluation[]>([]);
  const [loading, setLoading] = useState(true);

  const activeGoals = useMemo(() => goals.filter((g) => g.status === "active"), [goals]);

  const loadTargetData = useCallback(async () => {
    setLoading(true);
    try {
      const params = activeProjectId ? { projectId: activeProjectId } : {};
      const allTargets = await api.listTargets(params);
      setTargets(allTargets);
      const allEvals: TargetEvaluation[] = [];
      const goalIds = [...new Set(allTargets.filter((t) => t.goalId).map((t) => t.goalId!))];
      for (const goalId of goalIds) {
        try { allEvals.push(...await api.evaluateTargets({ goalId })); } catch { /* skip */ }
      }
      setEvaluations(allEvals);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [activeProjectId]);

  useEffect(() => { loadTargetData(); }, [loadTargetData]);
  useAgentEvent("dataTable.rowsChanged", loadTargetData);

  const targetsByGoal = useMemo(() => {
    const map = new Map<string, Target[]>();
    for (const t of targets) { if (!t.goalId) continue; const l = map.get(t.goalId) ?? []; l.push(t); map.set(t.goalId, l); }
    return map;
  }, [targets]);

  const getEval = (targetId: string) => evaluations.find((e) => e.targetId === targetId);

  const projectGroups = useMemo(() => {
    if (activeProjectId) return null;
    const map = new Map<string, typeof activeGoals>();
    for (const g of activeGoals) { const l = map.get(g.projectId) ?? []; l.push(g); map.set(g.projectId, l); }
    return map;
  }, [activeGoals, activeProjectId]);

  const topTargets = useMemo(() => {
    const result: { target: Target; evaluation: TargetEvaluation }[] = [];
    for (const t of targets) {
      const ev = getEval(t.id);
      if (ev) result.push({ target: t, evaluation: ev });
      if (result.length >= 30) break;
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets, evaluations]);

  return (
    <section>
      <div className="sticky top-0 z-10 bg-background flex items-center gap-2.5 border-b border-border px-6 py-3">
        <BarChart3 className="size-5 text-muted-foreground" />
        <h3 className="flex-1 text-base font-semibold">Insights</h3>
        {onToggle && (
          <button onClick={onToggle} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            {collapsed ? "View more" : "View less"}
            {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
          </button>
        )}
      </div>

      {loading ? (
        <p className="px-6 py-8 text-xs text-muted-foreground text-center">Loading insights...</p>
      ) : collapsed ? (
        <div className="px-6 py-3 space-y-2 animate-in fade-in duration-200">
          {topTargets.length > 0 ? (
            topTargets.map(({ target, evaluation }) => (
              <div key={target.id} className="flex items-center gap-2">
                <span className="w-20 shrink-0 truncate text-xs text-muted-foreground">{target.label ?? "Target"}</span>
                <div className="flex-1"><TargetProgressBar evaluation={evaluation} compact /></div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No targets set yet.</p>
          )}
        </div>
      ) : (
        <div className="space-y-8 px-6 pt-3 pb-1 animate-in fade-in slide-in-from-top-1 duration-300">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <TargetIcon className="size-4 text-muted-foreground" />
              <h4 className="text-xs font-semibold text-muted-foreground">Target Progress</h4>
            </div>
            {targets.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
                No targets set. Add targets to goals to track progress here.
              </p>
            ) : projectGroups ? (
              Array.from(projectGroups.entries()).map(([pid, pGoals]) => {
                const project = projects.find((p) => p.id === pid);
                const rootGoals = pGoals.filter((g) => !g.parentId);
                if (rootGoals.length === 0) return null;
                return (
                  <div key={pid} className="mb-4">
                    <h5 className="text-xs font-medium text-muted-foreground mb-2">{project?.name ?? "Unknown"}</h5>
                    {rootGoals.map((g) => (
                      <GoalTargetGroup key={g.id} goal={g} allGoals={pGoals} targetsByGoal={targetsByGoal} getEval={getEval} />
                    ))}
                  </div>
                );
              })
            ) : (
              activeGoals.filter((g) => !g.parentId).map((g) => (
                <GoalTargetGroup key={g.id} goal={g} allGoals={activeGoals} targetsByGoal={targetsByGoal} getEval={getEval} />
              ))
            )}
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <BarChart3 className="size-4 text-muted-foreground" />
              <h4 className="text-xs font-semibold text-muted-foreground">Charts</h4>
            </div>
            {projectGroups ? (
              Array.from(projectGroups.entries()).map(([pid]) => {
                const project = projects.find((p) => p.id === pid);
                return (
                  <div key={pid} className="mb-4">
                    <h5 className="text-xs font-medium text-muted-foreground mb-2">{project?.name ?? "Unknown"}</h5>
                    <VisualizationList projectId={pid} />
                  </div>
                );
              })
            ) : activeProjectId ? (
              <VisualizationList projectId={activeProjectId} />
            ) : (
              <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
                Select a project to view charts.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function GoalTargetGroup({ goal, allGoals, targetsByGoal, getEval, depth = 0 }: {
  goal: { id: string; name: string };
  allGoals: { id: string; name: string; parentId: string | null }[];
  targetsByGoal: Map<string, Target[]>;
  getEval: (id: string) => TargetEvaluation | undefined;
  depth?: number;
}) {
  const goalTargets = targetsByGoal.get(goal.id) ?? [];
  const children = allGoals.filter((g) => g.parentId === goal.id);
  const hasContent = goalTargets.length > 0 || children.some((c) =>
    (targetsByGoal.get(c.id) ?? []).length > 0 ||
    allGoals.some((g) => g.parentId === c.id)
  );
  if (!hasContent) return null;

  return (
    <div className="mb-4" style={{ paddingLeft: depth * 12 }}>
      <p className="text-xs font-medium mb-2">{goal.name}</p>
      <div className="space-y-2 pl-1">
        {goalTargets.map((t) => {
          const evaluation = getEval(t.id);
          return evaluation ? (
            <div key={t.id} className="rounded-md border border-border/50 px-3 py-3 space-y-1.5">
              <span className="text-xs font-medium text-foreground">{t.label ?? "Target"}</span>
              <TargetProgressBar evaluation={evaluation} />
            </div>
          ) : null;
        })}
      </div>
      {children.map((child) => (
        <GoalTargetGroup
          key={child.id}
          goal={child}
          allGoals={allGoals}
          targetsByGoal={targetsByGoal}
          getEval={getEval}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

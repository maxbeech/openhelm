/**
 * Section in goal detail view showing child/sub-goals.
 * Renders a simple list with name, status, and click-to-navigate.
 */

import { useMemo } from "react";
import { Flag, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NodeIcon } from "@/components/shared/node-icon";
import { useGoalStore } from "@/stores/goal-store";
import { useJobStore } from "@/stores/job-store";
import type { Goal } from "@openhelm/shared";

interface GoalSubGoalsSectionProps {
  parentGoalId: string;
  onSelectGoal: (goalId: string) => void;
  onNewSubGoal: () => void;
}

export function GoalSubGoalsSection({ parentGoalId, onSelectGoal, onNewSubGoal }: GoalSubGoalsSectionProps) {
  const { goals } = useGoalStore();
  const { jobs } = useJobStore();

  const childGoals = useMemo(
    () => goals
      .filter((g) => g.parentId === parentGoalId && g.status !== "archived")
      .sort((a, b) => a.sortOrder - b.sortOrder),
    [goals, parentGoalId],
  );

  const jobCountByGoal = useMemo(() => {
    const map = new Map<string, number>();
    for (const j of jobs) {
      if (j.goalId && !j.isArchived) {
        map.set(j.goalId, (map.get(j.goalId) ?? 0) + 1);
      }
    }
    return map;
  }, [jobs]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Flag className="size-4 text-muted-foreground" />
        <h3 className="flex-1 text-sm font-semibold">Sub-Goals</h3>
        <Button variant="outline" size="sm" onClick={onNewSubGoal}>
          <Plus className="mr-1 size-3.5" />
          Add Sub-Goal
        </Button>
      </div>
      {childGoals.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-4 text-center text-sm text-muted-foreground">
          No sub-goals yet. Break this goal into smaller objectives.
        </p>
      ) : (
        <div className="space-y-1">
          {childGoals.map((g) => (
            <SubGoalRow key={g.id} goal={g} jobCount={jobCountByGoal.get(g.id) ?? 0} onClick={() => onSelectGoal(g.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function SubGoalRow({ goal, jobCount, onClick }: { goal: Goal; jobCount: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
    >
      <NodeIcon icon={goal.icon} defaultIcon="flag" />
      <span className="flex-1 truncate">{goal.name}</span>
      {jobCount > 0 && (
        <span className="text-xs text-muted-foreground">{jobCount} job{jobCount !== 1 ? "s" : ""}</span>
      )}
      <Badge variant={goal.status === "active" ? "default" : "secondary"} className="text-2xs">
        {goal.status}
      </Badge>
    </button>
  );
}

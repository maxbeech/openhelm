/**
 * Breadcrumb showing the ancestor chain of a goal.
 * Renders: "Root Goal > Child Goal > Current Goal" with clickable links.
 */

import { ChevronRight } from "lucide-react";
import { useGoalStore } from "@/stores/goal-store";
import type { Goal } from "@openhelm/shared";

interface GoalBreadcrumbProps {
  goal: Goal;
  onSelectGoal: (goalId: string) => void;
}

export function GoalBreadcrumb({ goal, onSelectGoal }: GoalBreadcrumbProps) {
  const { goals } = useGoalStore();

  // Walk parentId chain to build ancestor list (root first)
  const ancestors: Goal[] = [];
  let current = goal;
  while (current.parentId) {
    const parent = goals.find((g) => g.id === current.parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    current = parent;
  }

  if (ancestors.length === 0) return null;

  return (
    <nav className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
      {ancestors.map((ancestor, i) => (
        <span key={ancestor.id} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="size-3" />}
          <button
            onClick={() => onSelectGoal(ancestor.id)}
            className="hover:text-foreground hover:underline transition-colors"
          >
            {ancestor.name || ancestor.description}
          </button>
        </span>
      ))}
      <ChevronRight className="size-3" />
      <span className="text-foreground font-medium">{goal.name || goal.description}</span>
    </nav>
  );
}

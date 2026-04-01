/**
 * Pure utility functions for building and manipulating goal trees.
 * No React dependencies — used by sidebar and dashboard components.
 */

import type { Goal, GoalTreeNode } from "@openhelm/shared";

/** Build a tree of GoalTreeNodes from a flat goal array */
export function buildGoalTree(goals: Goal[]): GoalTreeNode[] {
  const byId = new Map<string, GoalTreeNode>();
  const roots: GoalTreeNode[] = [];

  // Initialize nodes
  for (const goal of goals) {
    byId.set(goal.id, { ...goal, children: [], depth: 0 });
  }

  // Link children to parents
  for (const goal of goals) {
    const node = byId.get(goal.id)!;
    if (goal.parentId && byId.has(goal.parentId)) {
      const parent = byId.get(goal.parentId)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort children by sortOrder
  const sortChildren = (nodes: GoalTreeNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder);
    for (const node of nodes) sortChildren(node.children);
  };
  sortChildren(roots);

  return roots;
}

/** Flatten tree back to ordered array (DFS) for SortableContext */
export function flattenGoalTree(nodes: GoalTreeNode[]): GoalTreeNode[] {
  const result: GoalTreeNode[] = [];
  const walk = (list: GoalTreeNode[]) => {
    for (const node of list) {
      result.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return result;
}

/** Check if nesting draggedId under targetId is valid (no circular refs) */
export function canNestUnder(
  draggedId: string,
  targetId: string,
  allGoals: Goal[],
): boolean {
  if (draggedId === targetId) return false;

  // Check if targetId is a descendant of draggedId (would create cycle)
  const isDescendant = (parentId: string, checkId: string): boolean => {
    const children = allGoals.filter((g) => g.parentId === parentId);
    return children.some((c) => c.id === checkId || isDescendant(c.id, checkId));
  };

  return !isDescendant(draggedId, targetId);
}

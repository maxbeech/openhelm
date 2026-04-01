/**
 * Goal hierarchy helpers — ancestors, descendants, snapshot/restore for undo.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../init.js";
import { goals, jobs } from "../schema.js";
import type { Goal, GoalDeleteSnapshot } from "@openhelm/shared";

/** Get all ancestors of a goal, from immediate parent to root */
export function getGoalAncestors(goalId: string): Goal[] {
  const db = getDb();
  const ancestors: Goal[] = [];
  let current = db.select().from(goals).where(eq(goals.id, goalId)).get() as Goal | undefined;
  while (current?.parentId) {
    const parent = db.select().from(goals).where(eq(goals.id, current.parentId)).get() as Goal | undefined;
    if (!parent) break;
    ancestors.push(parent);
    current = parent;
  }
  return ancestors;
}

/** Get direct children of a goal, ordered by sortOrder */
export function getGoalChildren(goalId: string): Goal[] {
  const db = getDb();
  return db.select().from(goals)
    .where(eq(goals.parentId, goalId))
    .orderBy(goals.sortOrder)
    .all() as Goal[];
}

/** Get all descendants of a goal recursively */
export function getGoalDescendants(goalId: string): Goal[] {
  const children = getGoalChildren(goalId);
  const descendants: Goal[] = [...children];
  for (const child of children) {
    descendants.push(...getGoalDescendants(child.id));
  }
  return descendants;
}

/** Check if goalId is a descendant of potentialAncestorId */
export function isDescendantOf(goalId: string, potentialAncestorId: string): boolean {
  const children = getGoalChildren(potentialAncestorId);
  for (const child of children) {
    if (child.id === goalId) return true;
    if (isDescendantOf(goalId, child.id)) return true;
  }
  return false;
}

/** Collect a full snapshot of a goal subtree (for undo-delete) */
export function getGoalDeleteSnapshot(goalId: string): GoalDeleteSnapshot {
  const db = getDb();
  const goal = db.select().from(goals).where(eq(goals.id, goalId)).get() as Goal | undefined;
  if (!goal) return { goals: [], jobIds: [] };

  const descendants = getGoalDescendants(goalId);
  const allGoals = [goal, ...descendants];
  const allGoalIds = allGoals.map((g) => g.id);

  // Collect job IDs for all goals in the subtree
  const jobIds: string[] = [];
  for (const gid of allGoalIds) {
    const goalJobs = db.select({ id: jobs.id }).from(jobs).where(eq(jobs.goalId, gid)).all();
    jobIds.push(...goalJobs.map((j) => j.id));
  }

  return { goals: allGoals, jobIds };
}

/** Restore a deleted goal subtree from a snapshot */
export function restoreGoalDeleteSnapshot(snapshot: GoalDeleteSnapshot): void {
  const db = getDb();
  const now = new Date().toISOString();

  // Re-insert goals in order (parents before children)
  for (const goal of snapshot.goals) {
    const existing = db.select().from(goals).where(eq(goals.id, goal.id)).get();
    if (existing) continue; // already restored (e.g. race condition)
    db.insert(goals)
      .values({
        id: goal.id,
        projectId: goal.projectId,
        parentId: goal.parentId,
        name: goal.name,
        description: goal.description,
        status: goal.status,
        icon: goal.icon,
        sortOrder: goal.sortOrder,
        createdAt: goal.createdAt,
        updatedAt: now,
      })
      .run();
  }
}

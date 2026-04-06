import { eq, and, sql, max, isNull } from "drizzle-orm";
import { getDb } from "../init.js";
import { goals, jobs } from "../schema.js";
import {
  getGoalDescendants,
  isDescendantOf,
} from "./goal-hierarchy.js";
import type {
  Goal,
  GoalStatus,
  CreateGoalParams,
  UpdateGoalParams,
  ListGoalsParams,
  BulkReorderParams,
} from "@openhelm/shared";

export function createGoal(params: CreateGoalParams): Goal {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  // Auto-assign next sort_order scoped to siblings (same parentId)
  const siblingCondition = params.parentId
    ? eq(goals.parentId, params.parentId)
    : and(eq(goals.projectId, params.projectId), sql`${goals.parentId} IS NULL`);
  const maxResult = db
    .select({ maxOrder: max(goals.sortOrder) })
    .from(goals)
    .where(siblingCondition)
    .get();
  const sortOrder = (maxResult?.maxOrder ?? -1) + 1;

  const row = db
    .insert(goals)
    .values({
      id,
      projectId: params.projectId,
      parentId: params.parentId ?? null,
      name: params.name,
      description: params.description ?? "",
      status: "active",
      icon: params.icon ?? null,
      isSystem: params.isSystem ?? false,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return row as Goal;
}

export function getGoal(id: string): Goal | null {
  const db = getDb();
  const row = db.select().from(goals).where(eq(goals.id, id)).get();
  return (row as Goal) ?? null;
}

export function listGoals(params: ListGoalsParams): Goal[] {
  const db = getDb();
  const conditions = [];

  if (params.projectId) {
    conditions.push(eq(goals.projectId, params.projectId));
  }
  if (params.status) {
    conditions.push(eq(goals.status, params.status));
  }

  const query = conditions.length > 0
    ? db.select().from(goals).where(and(...conditions)).orderBy(goals.sortOrder)
    : db.select().from(goals).orderBy(goals.sortOrder);

  return query.all() as Goal[];
}

export function updateGoal(params: UpdateGoalParams): Goal {
  const db = getDb();
  const existing = getGoal(params.id);
  if (!existing) {
    throw new Error(`Goal not found: ${params.id}`);
  }

  const now = new Date().toISOString();

  // Validate parentId change — prevent circular references
  if (params.parentId !== undefined && params.parentId !== null) {
    if (params.parentId === params.id) {
      throw new Error("A goal cannot be its own parent");
    }
    if (isDescendantOf(params.parentId, params.id)) {
      throw new Error("Cannot nest a goal under its own descendant");
    }
  }

  // If archiving, also archive all descendant goals and their jobs atomically.
  // The parent goal's own status is also updated inside the transaction so that
  // a crash between the transaction and the outer db.update cannot leave the
  // parent as "active" while its children and jobs are already archived.
  if (params.status === "archived" && existing.status !== "archived") {
    const descendants = getGoalDescendants(params.id);
    db.transaction((tx) => {
      for (const desc of descendants) {
        tx.update(goals)
          .set({ status: "archived", updatedAt: now })
          .where(eq(goals.id, desc.id))
          .run();
        tx.update(jobs)
          .set({ isEnabled: false, isArchived: true, nextFireAt: null, updatedAt: now })
          .where(eq(jobs.goalId, desc.id))
          .run();
      }
      tx.update(jobs)
        .set({ isEnabled: false, isArchived: true, nextFireAt: null, updatedAt: now })
        .where(eq(jobs.goalId, params.id))
        .run();
      // Archive the parent goal itself — must be inside the transaction to be atomic
      tx.update(goals)
        .set({ status: "archived", updatedAt: now })
        .where(eq(goals.id, params.id))
        .run();
    });
  }

  const row = db
    .update(goals)
    .set({
      ...(params.name !== undefined && { name: params.name }),
      ...(params.description !== undefined && { description: params.description }),
      ...(params.status !== undefined && { status: params.status }),
      ...(params.icon !== undefined && { icon: params.icon }),
      ...(params.parentId !== undefined && { parentId: params.parentId }),
      updatedAt: now,
    })
    .where(eq(goals.id, params.id))
    .returning()
    .get();

  return row as Goal;
}

export function deleteGoal(id: string): boolean {
  const db = getDb();
  // System goals cannot be deleted (Autopilot Maintenance, etc.)
  const target = getGoal(id);
  if (target?.isSystem) {
    throw new Error("Cannot delete a system goal");
  }
  // goals.parentId has ON DELETE CASCADE, so deleting a parent cascades to children.
  // But jobs.goalId has ON DELETE SET NULL — without explicit cleanup the child goals'
  // jobs would survive with a null goalId, leaking as orphaned standalone jobs.
  const descendants = getGoalDescendants(id);
  const allGoalIds = [id, ...descendants.map((d) => d.id)];
  const result = db.transaction((tx) => {
    for (const gid of allGoalIds) {
      tx.delete(jobs).where(eq(jobs.goalId, gid)).run();
    }
    return tx.delete(goals).where(eq(goals.id, id)).run();
  });
  return result.changes > 0;
}

/** Bulk-update sort_order for multiple goals */
export function reorderGoals(params: BulkReorderParams): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.transaction((tx) => {
    for (const item of params.items) {
      tx.update(goals)
        .set({ sortOrder: item.sortOrder, updatedAt: now })
        .where(eq(goals.id, item.id))
        .run();
    }
  });
}

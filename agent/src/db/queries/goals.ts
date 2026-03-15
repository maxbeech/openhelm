import { eq, and } from "drizzle-orm";
import { getDb } from "../init.js";
import { goals, jobs } from "../schema.js";
import type {
  Goal,
  GoalStatus,
  CreateGoalParams,
  UpdateGoalParams,
  ListGoalsParams,
} from "@openorchestra/shared";

export function createGoal(params: CreateGoalParams): Goal {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const row = db
    .insert(goals)
    .values({
      id,
      projectId: params.projectId,
      name: params.name,
      description: params.description ?? "",
      status: "active",
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
    ? db.select().from(goals).where(and(...conditions))
    : db.select().from(goals);

  return query.all() as Goal[];
}

export function updateGoal(params: UpdateGoalParams): Goal {
  const db = getDb();
  const existing = getGoal(params.id);
  if (!existing) {
    throw new Error(`Goal not found: ${params.id}`);
  }

  const now = new Date().toISOString();

  // If archiving, disable and archive all associated jobs
  if (params.status === "archived" && existing.status !== "archived") {
    db.update(jobs)
      .set({ isEnabled: false, isArchived: true, nextFireAt: null, updatedAt: now })
      .where(eq(jobs.goalId, params.id))
      .run();
  }

  const row = db
    .update(goals)
    .set({
      ...(params.name !== undefined && { name: params.name }),
      ...(params.description !== undefined && { description: params.description }),
      ...(params.status !== undefined && { status: params.status }),
      ...(params.icon !== undefined && { icon: params.icon }),
      updatedAt: now,
    })
    .where(eq(goals.id, params.id))
    .returning()
    .get();

  return row as Goal;
}

export function deleteGoal(id: string): boolean {
  const db = getDb();
  // Delete associated jobs first (FK is set null, not cascade)
  // Deleting jobs cascades to their runs and run_logs via FK
  db.delete(jobs).where(eq(jobs.goalId, id)).run();
  const result = db.delete(goals).where(eq(goals.id, id)).run();
  return result.changes > 0;
}

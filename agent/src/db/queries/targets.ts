import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../init.js";
import { targets } from "../schema.js";
import type {
  Target,
  TargetDirection,
  TargetAggregation,
  TargetCreatedBy,
  CreateTargetParams,
  UpdateTargetParams,
  ListTargetsParams,
} from "@openhelm/shared";

// ─── Row mapper ───

function rowToTarget(row: typeof targets.$inferSelect): Target {
  return {
    ...row,
    goalId: row.goalId ?? null,
    jobId: row.jobId ?? null,
    label: row.label ?? null,
    deadline: row.deadline ?? null,
    targetValue: Number(row.targetValue),
    direction: row.direction as TargetDirection,
    aggregation: row.aggregation as TargetAggregation,
    createdBy: row.createdBy as TargetCreatedBy,
  };
}

// ─── CRUD ───

export function createTarget(params: CreateTargetParams): Target {
  const hasGoal = !!params.goalId;
  const hasJob = !!params.jobId;
  if (hasGoal === hasJob) {
    throw new Error("Exactly one of goalId or jobId must be provided");
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const row = db
    .insert(targets)
    .values({
      id,
      goalId: params.goalId ?? null,
      jobId: params.jobId ?? null,
      projectId: params.projectId,
      dataTableId: params.dataTableId,
      columnId: params.columnId,
      targetValue: params.targetValue,
      direction: params.direction ?? "gte",
      aggregation: params.aggregation ?? "latest",
      label: params.label ?? null,
      deadline: params.deadline ?? null,
      createdBy: params.createdBy ?? "user",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return rowToTarget(row);
}

export function getTarget(id: string): Target | null {
  const db = getDb();
  const row = db.select().from(targets).where(eq(targets.id, id)).get();
  return row ? rowToTarget(row) : null;
}

export function listTargets(params: ListTargetsParams): Target[] {
  const db = getDb();
  const conditions: ReturnType<typeof eq>[] = [];

  if (params.goalId) conditions.push(eq(targets.goalId, params.goalId));
  if (params.jobId) conditions.push(eq(targets.jobId, params.jobId));
  if (params.projectId) conditions.push(eq(targets.projectId, params.projectId));
  if (params.dataTableId) conditions.push(eq(targets.dataTableId, params.dataTableId));

  return db
    .select()
    .from(targets)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(targets.createdAt))
    .all()
    .map(rowToTarget);
}

export function updateTarget(params: UpdateTargetParams): Target {
  const db = getDb();
  const existing = getTarget(params.id);
  if (!existing) throw new Error(`Target not found: ${params.id}`);

  const row = db
    .update(targets)
    .set({
      ...(params.targetValue !== undefined && { targetValue: params.targetValue }),
      ...(params.direction !== undefined && { direction: params.direction }),
      ...(params.aggregation !== undefined && { aggregation: params.aggregation }),
      ...(params.label !== undefined && { label: params.label }),
      ...(params.deadline !== undefined && { deadline: params.deadline }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(targets.id, params.id))
    .returning()
    .get();

  if (!row) throw new Error(`Target disappeared during update: ${params.id}`);
  return rowToTarget(row);
}

export function deleteTarget(id: string): boolean {
  const db = getDb();
  const result = db.delete(targets).where(eq(targets.id, id)).run();
  return result.changes > 0;
}


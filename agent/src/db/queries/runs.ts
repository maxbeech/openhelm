import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../init.js";
import { runs } from "../schema.js";
import type {
  Run,
  RunStatus,
  CreateRunParams,
  UpdateRunParams,
  ListRunsParams,
} from "@openorchestra/shared";

export function createRun(params: CreateRunParams): Run {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const row = db
    .insert(runs)
    .values({
      id,
      jobId: params.jobId,
      status: "queued",
      triggerSource: params.triggerSource,
      createdAt: now,
    })
    .returning()
    .get();

  return row as Run;
}

export function getRun(id: string): Run | null {
  const db = getDb();
  const row = db.select().from(runs).where(eq(runs.id, id)).get();
  return (row as Run) ?? null;
}

export function listRuns(params?: ListRunsParams): Run[] {
  const db = getDb();
  const conditions = [];

  if (params?.jobId) {
    conditions.push(eq(runs.jobId, params.jobId));
  }
  if (params?.status) {
    conditions.push(eq(runs.status, params.status));
  }

  const limit = params?.limit ?? 50;
  const offset = params?.offset ?? 0;

  const query =
    conditions.length > 0
      ? db
          .select()
          .from(runs)
          .where(and(...conditions))
      : db.select().from(runs);

  return query
    .orderBy(desc(runs.createdAt))
    .limit(limit)
    .offset(offset)
    .all() as Run[];
}

export function updateRun(params: UpdateRunParams): Run {
  const db = getDb();
  const existing = getRun(params.id);
  if (!existing) {
    throw new Error(`Run not found: ${params.id}`);
  }

  const row = db
    .update(runs)
    .set({
      ...(params.status !== undefined && { status: params.status }),
      ...(params.startedAt !== undefined && { startedAt: params.startedAt }),
      ...(params.finishedAt !== undefined && {
        finishedAt: params.finishedAt,
      }),
      ...(params.exitCode !== undefined && { exitCode: params.exitCode }),
      ...(params.summary !== undefined && { summary: params.summary }),
    })
    .where(eq(runs.id, params.id))
    .returning()
    .get();

  return row as Run;
}

export function deleteRun(id: string): boolean {
  const db = getDb();
  const result = db.delete(runs).where(eq(runs.id, id)).run();
  return result.changes > 0;
}

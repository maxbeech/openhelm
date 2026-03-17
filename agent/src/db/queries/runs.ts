import { eq, and, desc, inArray, lte } from "drizzle-orm";
import { getDb } from "../init.js";
import { runs, jobs } from "../schema.js";
import type {
  Run,
  RunStatus,
  CreateRunParams,
  UpdateRunParams,
  ListRunsParams,
} from "@openorchestra/shared";

function rowToRun(row: typeof runs.$inferSelect): Run {
  return {
    ...row,
    parentRunId: row.parentRunId ?? null,
    correctionNote: row.correctionNote ?? null,
    sessionId: row.sessionId ?? null,
  } as Run;
}

/**
 * Valid status transitions for the run state machine.
 * Terminal states (succeeded, failed, permanent_failure, cancelled) have no outgoing edges.
 */
const VALID_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  deferred: ["queued", "cancelled"],
  queued: ["running", "cancelled", "permanent_failure"],
  running: ["succeeded", "failed", "permanent_failure", "cancelled"],
  succeeded: [],
  failed: ["permanent_failure"],
  permanent_failure: [],
  cancelled: [],
};

export function createRun(params: CreateRunParams): Run {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const row = db
    .insert(runs)
    .values({
      id,
      jobId: params.jobId,
      status: params.status ?? "queued",
      triggerSource: params.triggerSource,
      parentRunId: params.parentRunId ?? null,
      correctionNote: params.correctionNote ?? null,
      scheduledFor: params.scheduledFor ?? null,
      createdAt: now,
    })
    .returning()
    .get();

  return rowToRun(row);
}

export function getRun(id: string): Run | null {
  const db = getDb();
  const row = db.select().from(runs).where(eq(runs.id, id)).get();
  return row ? rowToRun(row) : null;
}

export function listRuns(params?: ListRunsParams): Run[] {
  const db = getDb();
  const conditions = [];

  if (params?.projectId) {
    const jobIdsSubquery = db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.projectId, params.projectId));
    conditions.push(inArray(runs.jobId, jobIdsSubquery));
  }
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
    .all()
    .map(rowToRun);
}

/** Returns deferred runs whose scheduledFor time has passed and are ready to be enqueued. */
export function listDeferredDueRuns(): Run[] {
  const db = getDb();
  const now = new Date().toISOString();
  return db
    .select()
    .from(runs)
    .where(and(eq(runs.status, "deferred"), lte(runs.scheduledFor, now)))
    .limit(100)
    .all()
    .map(rowToRun);
}

export function updateRun(params: UpdateRunParams): Run {
  const db = getDb();
  const existing = getRun(params.id);
  if (!existing) {
    throw new Error(`Run not found: ${params.id}`);
  }

  // Enforce state machine when status is changing
  if (params.status !== undefined && params.status !== existing.status) {
    const allowed = VALID_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(params.status)) {
      throw new Error(
        `Invalid status transition: ${existing.status} → ${params.status}`,
      );
    }
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
      ...(params.sessionId !== undefined && { sessionId: params.sessionId }),
    })
    .where(eq(runs.id, params.id))
    .returning()
    .get();

  return rowToRun(row);
}

export function deleteRun(id: string): boolean {
  const db = getDb();
  const result = db.delete(runs).where(eq(runs.id, id)).run();
  return result.changes > 0;
}

/** Check if a corrective run already exists for a given parent run */
export function hasCorrectiveRun(parentRunId: string): boolean {
  const db = getDb();
  const row = db
    .select()
    .from(runs)
    .where(eq(runs.parentRunId, parentRunId))
    .get();
  return !!row;
}

/** Snapshot a correction note onto a run (for archival after execution starts) */
export function snapshotRunCorrectionNote(runId: string, note: string): void {
  const db = getDb();
  db.update(runs)
    .set({ correctionNote: note })
    .where(eq(runs.id, runId))
    .run();
}

/**
 * Walk the parentRunId chain counting corrective runs.
 * Returns the number of corrective ancestors (0 if the run is an original).
 * Bounded by maxWalk to prevent runaway in corrupted data.
 */
export function getCorrectionChainDepth(runId: string, maxWalk = 10): number {
  let depth = 0;
  let currentId: string | null = runId;
  while (currentId && depth < maxWalk) {
    const run = getRun(currentId);
    if (!run) break;
    if (run.triggerSource === "corrective") {
      depth++;
      currentId = run.parentRunId;
    } else {
      break;
    }
  }
  return depth;
}

export function clearRunsByJob(jobId: string): number {
  const db = getDb();
  const result = db.delete(runs).where(eq(runs.jobId, jobId)).run();
  return result.changes;
}

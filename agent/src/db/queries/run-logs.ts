import { eq, and, gt, asc } from "drizzle-orm";
import { getDb } from "../init.js";
import { runLogs } from "../schema.js";
import type {
  RunLog,
  CreateRunLogParams,
  ListRunLogsParams,
} from "@openorchestra/shared";

/** Get the next sequence number for a given run */
function nextSequence(runId: string): number {
  const db = getDb();
  const last = db
    .select({ sequence: runLogs.sequence })
    .from(runLogs)
    .where(eq(runLogs.runId, runId))
    .orderBy(asc(runLogs.sequence))
    .limit(1)
    .all();

  // Query all and find the max (SQLite doesn't have a clean max aggregate via Drizzle)
  const all = db
    .select({ sequence: runLogs.sequence })
    .from(runLogs)
    .where(eq(runLogs.runId, runId))
    .all();

  if (all.length === 0) return 1;
  return Math.max(...all.map((r) => r.sequence)) + 1;
}

export function createRunLog(params: CreateRunLogParams): RunLog {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const sequence = nextSequence(params.runId);

  const row = db
    .insert(runLogs)
    .values({
      id,
      runId: params.runId,
      sequence,
      stream: params.stream,
      text: params.text,
      timestamp: now,
    })
    .returning()
    .get();

  return row as RunLog;
}

export function listRunLogs(params: ListRunLogsParams): RunLog[] {
  const db = getDb();
  const conditions = [eq(runLogs.runId, params.runId)];

  if (params.afterSequence !== undefined) {
    conditions.push(gt(runLogs.sequence, params.afterSequence));
  }

  return db
    .select()
    .from(runLogs)
    .where(and(...conditions))
    .orderBy(asc(runLogs.sequence))
    .all() as RunLog[];
}

export function deleteRunLogs(runId: string): boolean {
  const db = getDb();
  const result = db.delete(runLogs).where(eq(runLogs.runId, runId)).run();
  return result.changes > 0;
}

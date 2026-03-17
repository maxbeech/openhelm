import { eq, and, gt, asc, sql } from "drizzle-orm";
import { getDb } from "../init.js";
import { runLogs } from "../schema.js";
import type {
  RunLog,
  CreateRunLogParams,
  ListRunLogsParams,
} from "@openorchestra/shared";

/** Get the next sequence number for a given run via MAX aggregate (O(1) with index) */
function nextSequence(runId: string): number {
  const db = getDb();
  const row = db
    .select({ maxSeq: sql<number>`COALESCE(MAX(${runLogs.sequence}), 0)` })
    .from(runLogs)
    .where(eq(runLogs.runId, runId))
    .get();
  return (row?.maxSeq ?? 0) + 1;
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

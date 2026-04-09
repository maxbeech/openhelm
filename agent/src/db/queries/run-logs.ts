import { eq, and, gt, asc, or, like, sql } from "drizzle-orm";
import { getDb } from "../init.js";
import { runLogs } from "../schema.js";
import type {
  RunLog,
  CreateRunLogParams,
  ListRunLogsParams,
} from "@openhelm/shared";

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

/**
 * Detect whether a run failed with a non-resumable error — one where the
 * session itself cannot be continued because re-attaching to it would hit
 * the same failure again. The canonical case is "Prompt is too long":
 * the accumulated context has exceeded the model's window, and resuming
 * the session will immediately re-submit the same oversized context.
 *
 * Used by the executor and self-correction to decide whether a corrective
 * retry should start a fresh Claude Code session or resume the parent's.
 */
export function hasTokenLimitError(runId: string): boolean {
  const db = getDb();
  const row = db
    .select({ id: runLogs.id })
    .from(runLogs)
    .where(
      and(
        eq(runLogs.runId, runId),
        // Only inspect stderr — error results are forwarded there exclusively
        // (runner.ts). Scanning stdout risks false positives if a job's output
        // happens to mention these error strings (e.g. docs, test fixtures).
        eq(runLogs.stream, "stderr"),
        or(
          like(runLogs.text, "%Prompt is too long%"),
          like(runLogs.text, "%prompt is too long%"),
          like(runLogs.text, "%context_length_exceeded%"),
          like(runLogs.text, "%maximum context length%"),
          like(runLogs.text, "%input length and `max_tokens` exceed%"),
        ),
      ),
    )
    .limit(1)
    .get();
  return row != null;
}

/**
 * Detect whether a run's logs contain "No such tool available: mcp__*".
 * This indicates an MCP server was configured but failed to start or timed
 * out during Claude Code's initialization handshake. The error appears in
 * Claude's stdout response text (not stderr), so we check both streams.
 * The pattern is specific enough to avoid false positives.
 */
export function hasMcpToolMissingError(runId: string): boolean {
  const db = getDb();
  const row = db
    .select({ id: runLogs.id })
    .from(runLogs)
    .where(
      and(
        eq(runLogs.runId, runId),
        or(
          like(runLogs.text, "%No such tool available: mcp__%"),
          like(runLogs.text, "%no such tool available: mcp__%"),
        ),
      ),
    )
    .limit(1)
    .get();
  return row != null;
}

export function deleteRunLogs(runId: string): boolean {
  const db = getDb();
  const result = db.delete(runLogs).where(eq(runLogs.runId, runId)).run();
  return result.changes > 0;
}

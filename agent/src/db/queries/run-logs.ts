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
 *
 * NOTE: this returns true whenever the error appears ANYWHERE in the logs —
 * including when Claude subsequently recovered by retrying with the correct
 * tool name (e.g. hyphen vs underscore for Notion MCP tools) or when the MCP
 * server briefly missed the first handshake but served later calls fine.
 * Use `countMcpToolMissingErrorsByServer()` + tool-stat comparison to tell
 * recoverable from unrecoverable failures.
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

/**
 * Return, per MCP server, how many times "No such tool available: mcp__<server>__*"
 * appeared in this run's logs. Used to decide whether Claude recovered from
 * the error: if `toolStats` shows more invocations of `mcp__<server>__*` than
 * errors for that server, at least one call succeeded after the error — the
 * server is working and the run should NOT be force-failed.
 *
 * The text pattern follows the exact format Claude emits for tool_result
 * errors: `No such tool available: mcp__openhelm_browser__navigate`.
 */
export function countMcpToolMissingErrorsByServer(runId: string): Map<string, number> {
  const db = getDb();
  const rows = db
    .select({ text: runLogs.text })
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
    .all();

  const counts = new Map<string, number>();
  // Match `mcp__<server>__<tool>` — server names may contain letters, digits,
  // underscores, or hyphens, but the double-underscore delimiter is fixed.
  const re = /no such tool available:\s*mcp__([a-zA-Z0-9_-]+)__[a-zA-Z0-9_-]+/gi;
  for (const row of rows) {
    if (!row.text) continue;
    for (const match of row.text.matchAll(re)) {
      const server = match[1];
      counts.set(server, (counts.get(server) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Given the per-server error counts from `countMcpToolMissingErrorsByServer`
 * and the `toolStats` array captured by the runner, decide whether the run
 * had an UNRECOVERED MCP tool-missing failure — i.e. at least one MCP server
 * erred more times than it was successfully invoked, meaning Claude never
 * managed to use that server for real work.
 *
 * Returns the list of server names that are genuinely unrecovered. An empty
 * list means either (a) no tool-missing errors happened or (b) every server
 * that erred had enough additional invocations to indicate it recovered.
 */
export function findUnrecoveredMcpServers(
  errorsByServer: Map<string, number>,
  toolStats: Array<{ toolName: string; invocations: number }> | undefined,
): string[] {
  if (errorsByServer.size === 0) return [];
  // Sum total tool_use invocations per server (mcp__<server>__*).
  const invocationsByServer = new Map<string, number>();
  for (const stat of toolStats ?? []) {
    const m = stat.toolName.match(/^mcp__([a-zA-Z0-9_-]+)__/);
    if (!m) continue;
    invocationsByServer.set(
      m[1],
      (invocationsByServer.get(m[1]) ?? 0) + stat.invocations,
    );
  }
  const unrecovered: string[] = [];
  for (const [server, errorCount] of errorsByServer) {
    const invocations = invocationsByServer.get(server) ?? 0;
    // If total invocations > errors, at least one call succeeded → recovered.
    // If invocations <= errors, every attempt erred → unrecovered.
    if (invocations <= errorCount) {
      unrecovered.push(server);
    }
  }
  return unrecovered;
}

export function deleteRunLogs(runId: string): boolean {
  const db = getDb();
  const result = db.delete(runLogs).where(eq(runLogs.runId, runId)).run();
  return result.changes > 0;
}

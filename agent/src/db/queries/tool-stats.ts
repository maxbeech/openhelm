import { eq, and, desc, inArray, lte, gte, sql } from "drizzle-orm";
import { getDb } from "../init.js";
import { runs, jobs, runToolStats } from "../schema.js";
import type { RunToolStat, GetRunToolStatsParams } from "@openhelm/shared";

const TERMINAL_STATUSES = ["succeeded", "failed", "permanent_failure"] as const;

/**
 * Insert per-tool stats for a completed run.
 * Called by the executor after each run finishes.
 */
export function insertRunToolStats(runId: string, stats: RunToolStat[]): void {
  if (stats.length === 0) return;
  const db = getDb();
  db.insert(runToolStats)
    .values(
      stats.map((s) => ({
        runId,
        toolName: s.toolName,
        invocations: s.invocations,
        approxOutputTokens: s.approxOutputTokens,
      })),
    )
    .run();
}

/**
 * Return per-tool invocation + approximate token stats aggregated
 * across terminal runs, filtered by project/jobIds/date range.
 */
export function getRunToolStats(params: GetRunToolStatsParams): RunToolStat[] {
  const db = getDb();

  const conditions = [inArray(runs.status, [...TERMINAL_STATUSES])];

  if (params.projectId) {
    const jobIdsSubquery = db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.projectId, params.projectId));
    conditions.push(inArray(runs.jobId, jobIdsSubquery));
  }

  if (params.jobIds && params.jobIds.length > 0) {
    conditions.push(inArray(runs.jobId, params.jobIds));
  }

  if (params.from) {
    conditions.push(gte(runs.startedAt, params.from));
  }

  if (params.to) {
    conditions.push(lte(runs.startedAt, params.to));
  }

  const rows = db
    .select({
      toolName: runToolStats.toolName,
      invocations: sql<number>`COALESCE(SUM(${runToolStats.invocations}), 0)`,
      approxOutputTokens: sql<number>`COALESCE(SUM(${runToolStats.approxOutputTokens}), 0)`,
    })
    .from(runToolStats)
    .innerJoin(runs, eq(runToolStats.runId, runs.id))
    .where(and(...conditions))
    .groupBy(runToolStats.toolName)
    .orderBy(desc(sql`COALESCE(SUM(${runToolStats.invocations}), 0)`))
    .all();

  return rows.map((r) => ({
    toolName: r.toolName,
    invocations: Number(r.invocations),
    approxOutputTokens: Number(r.approxOutputTokens),
  }));
}

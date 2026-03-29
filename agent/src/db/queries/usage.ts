import { eq, inArray, desc, sql } from "drizzle-orm";
import { getDb } from "../init.js";
import { claudeUsageSnapshots, runs, jobs } from "../schema.js";
import type { ClaudeUsageSnapshot } from "@openhelm/shared";

// ─── Snapshots ───────────────────────────────────────────────────────────────

export function upsertUsageSnapshot(
  snapshot: Omit<ClaudeUsageSnapshot, "id"> & { id?: string },
): ClaudeUsageSnapshot {
  const db = getDb();
  const id = snapshot.id ?? crypto.randomUUID();
  const row = db
    .insert(claudeUsageSnapshots)
    .values({ id, ...snapshot })
    .onConflictDoUpdate({
      target: claudeUsageSnapshots.date,
      set: {
        recordedAt: snapshot.recordedAt,
        totalInputTokens: snapshot.totalInputTokens,
        totalOutputTokens: snapshot.totalOutputTokens,
        sonnetInputTokens: snapshot.sonnetInputTokens,
        sonnetOutputTokens: snapshot.sonnetOutputTokens,
        openHelmInputTokens: snapshot.openHelmInputTokens,
        openHelmOutputTokens: snapshot.openHelmOutputTokens,
      },
    })
    .returning()
    .get();
  return row as ClaudeUsageSnapshot;
}

/** Returns the most recent N snapshots, ordered by date descending */
export function listUsageSnapshots(limit = 35): ClaudeUsageSnapshot[] {
  const db = getDb();
  return db
    .select()
    .from(claudeUsageSnapshots)
    .orderBy(desc(claudeUsageSnapshots.date))
    .limit(limit)
    .all() as ClaudeUsageSnapshot[];
}

/** Prune old rows, keeping only the most recent `keep` days */
export function pruneUsageSnapshots(keep = 35): void {
  const db = getDb();
  const recent = db
    .select({ date: claudeUsageSnapshots.date })
    .from(claudeUsageSnapshots)
    .orderBy(desc(claudeUsageSnapshots.date))
    .limit(keep)
    .all()
    .map((r) => r.date);
  if (recent.length === 0) return;
  db.delete(claudeUsageSnapshots)
    .where(sql`${claudeUsageSnapshots.date} NOT IN (${sql.join(recent.map(d => sql`${d}`), sql`, `)})`)
    .run();
}

// ─── OpenHelm token aggregation by UTC date ───────────────────────────────────

export interface OpenhelmDayTokens {
  date: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Returns per-UTC-day OpenHelm token sums for the given dates.
 * Only includes terminal runs (succeeded / failed / permanent_failure).
 */
export function getOpenhelmTokensByDates(
  dates: string[],
): OpenhelmDayTokens[] {
  if (dates.length === 0) return [];
  const db = getDb();

  const rows = db
    .select({
      date: sql<string>`strftime('%Y-%m-%d', ${runs.startedAt})`,
      inputTokens: sql<number>`COALESCE(SUM(${runs.inputTokens}), 0)`,
      outputTokens: sql<number>`COALESCE(SUM(${runs.outputTokens}), 0)`,
    })
    .from(runs)
    .where(
      sql`strftime('%Y-%m-%d', ${runs.startedAt}) IN (${sql.join(dates.map(d => sql`${d}`), sql`, `)})
        AND ${runs.status} IN ('succeeded', 'failed', 'permanent_failure')`,
    )
    .groupBy(sql`strftime('%Y-%m-%d', ${runs.startedAt})`)
    .all();

  return rows.map((r) => ({
    date: r.date,
    inputTokens: Number(r.inputTokens),
    outputTokens: Number(r.outputTokens),
  }));
}

/**
 * Returns the set of OpenHelm session IDs that contributed to each of the given dates.
 * Used to correlate JSONL sessions with OpenHelm runs.
 */
export function getOpenhelmSessionIdsByDates(
  dates: string[],
): Map<string, Set<string>> {
  if (dates.length === 0) return new Map();
  const db = getDb();

  const rows = db
    .select({
      date: sql<string>`strftime('%Y-%m-%d', ${runs.startedAt})`,
      sessionId: runs.sessionId,
    })
    .from(runs)
    .where(
      sql`strftime('%Y-%m-%d', ${runs.startedAt}) IN (${sql.join(dates.map(d => sql`${d}`), sql`, `)})
        AND ${runs.sessionId} IS NOT NULL`,
    )
    .all();

  const result = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.sessionId) continue;
    let set = result.get(row.date);
    if (!set) { set = new Set(); result.set(row.date, set); }
    set.add(row.sessionId);
  }
  return result;
}

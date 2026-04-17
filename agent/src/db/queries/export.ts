import { sql } from "drizzle-orm";
import { getDb } from "../init.js";
import {
  settings,
  projects,
  goals,
  jobs,
  runs,
  runLogs,
  runConnections,
  conversations,
  messages,
  dashboardItems,
  memories,
  runMemories,
  connections,
  connectionScopeBindings,
} from "../schema.js";
import type {
  Project,
  Goal,
  Job,
  Run,
  RunLog,
  Conversation,
  ChatMessage,
  DashboardItem,
  Memory,
  Setting,
  RecordCounts,
  ExportStatsResult,
} from "@openhelm/shared";

// ─── Row → entity converters (parse JSON columns) ───

function rowToJob(row: typeof jobs.$inferSelect): Job {
  return {
    ...row,
    goalId: row.goalId ?? null,
    scheduleConfig: JSON.parse(row.scheduleConfig),
    isEnabled: !!row.isEnabled,
    isArchived: !!row.isArchived,
    workingDirectory: row.workingDirectory ?? null,
    nextFireAt: row.nextFireAt ?? null,
    icon: row.icon ?? null,
    correctionNote: row.correctionNote ?? null,
  } as Job;
}

function rowToRun(row: typeof runs.$inferSelect): Run {
  return {
    ...row,
    parentRunId: row.parentRunId ?? null,
    correctionNote: row.correctionNote ?? null,
    scheduledFor: row.scheduledFor ?? null,
    startedAt: row.startedAt ?? null,
    finishedAt: row.finishedAt ?? null,
    exitCode: row.exitCode ?? null,
    summary: row.summary ?? null,
    sessionId: row.sessionId ?? null,
  } as Run;
}

function rowToMessage(row: typeof messages.$inferSelect): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as ChatMessage["role"],
    content: row.content,
    toolCalls: row.toolCalls ? JSON.parse(row.toolCalls) : null,
    toolResults: row.toolResults ? JSON.parse(row.toolResults) : null,
    pendingActions: row.pendingActions ? JSON.parse(row.pendingActions) : null,
    createdAt: row.createdAt,
  };
}

function rowToMemory(row: typeof memories.$inferSelect): Memory {
  return {
    ...row,
    goalId: row.goalId ?? null,
    jobId: row.jobId ?? null,
    sourceId: row.sourceId ?? null,
    lastAccessedAt: row.lastAccessedAt ?? null,
    tags: JSON.parse(row.tags || "[]"),
    isArchived: !!row.isArchived,
  } as Memory;
}

// ─── Export ───

export interface ExportData {
  projects: Project[];
  goals: Goal[];
  jobs: Job[];
  runs: Run[];
  runLogs: RunLog[];
  conversations: Conversation[];
  messages: ChatMessage[];
  dashboardItems: DashboardItem[];
  memories: Memory[];
  runMemories: { runId: string; memoryId: string }[];
  settings: Setting[];
}

export function exportAll(includeRunLogs: boolean): ExportData {
  const db = getDb();
  return {
    settings: db.select().from(settings).all() as Setting[],
    projects: db.select().from(projects).all() as Project[],
    goals: db.select().from(goals).all() as Goal[],
    jobs: db.select().from(jobs).all().map(rowToJob),
    runs: db.select().from(runs).all().map(rowToRun),
    runLogs: includeRunLogs
      ? (db.select().from(runLogs).all() as RunLog[])
      : [],
    conversations: db.select().from(conversations).all() as Conversation[],
    messages: db.select().from(messages).all().map(rowToMessage),
    dashboardItems: db.select().from(dashboardItems).all() as DashboardItem[],
    memories: db.select().from(memories).all().map(rowToMemory),
    runMemories: db.select().from(runMemories).all(),
  };
}

export function getExportStats(): ExportStatsResult {
  const db = getDb();

  const counts = {
    settings: db.select({ c: sql<number>`count(*)` }).from(settings).get()?.c ?? 0,
    projects: db.select({ c: sql<number>`count(*)` }).from(projects).get()?.c ?? 0,
    goals: db.select({ c: sql<number>`count(*)` }).from(goals).get()?.c ?? 0,
    jobs: db.select({ c: sql<number>`count(*)` }).from(jobs).get()?.c ?? 0,
    runs: db.select({ c: sql<number>`count(*)` }).from(runs).get()?.c ?? 0,
    runLogs: db.select({ c: sql<number>`count(*)` }).from(runLogs).get()?.c ?? 0,
    conversations: db.select({ c: sql<number>`count(*)` }).from(conversations).get()?.c ?? 0,
    messages: db.select({ c: sql<number>`count(*)` }).from(messages).get()?.c ?? 0,
    dashboardItems: db.select({ c: sql<number>`count(*)` }).from(dashboardItems).get()?.c ?? 0,
    memories: db.select({ c: sql<number>`count(*)` }).from(memories).get()?.c ?? 0,
    runMemories: db.select({ c: sql<number>`count(*)` }).from(runMemories).get()?.c ?? 0,
  };

  const totalWithoutLogs = Object.entries(counts)
    .filter(([k]) => k !== "runLogs")
    .reduce((sum, [, v]) => sum + v, 0);

  // Rough estimate: ~500 bytes per record, ~1KB per run log
  const estimatedSizeWithoutLogs = totalWithoutLogs * 500;
  const estimatedSizeWithLogs = estimatedSizeWithoutLogs + counts.runLogs * 1000;

  return {
    totalRecords: totalWithoutLogs + counts.runLogs,
    runLogCount: counts.runLogs,
    estimatedSizeWithLogs,
    estimatedSizeWithoutLogs,
  };
}

// ─── Clear & Import ───

/** Validates JSON-encodable fields in import data, throwing descriptively on malformed input. */
function validateImportData(data: ExportData): void {
  for (let i = 0; i < data.jobs.length; i++) {
    const j = data.jobs[i];
    if (typeof j.scheduleConfig !== "object" || j.scheduleConfig === null) {
      throw new Error(
        `jobs[${i}] (id=${j.id}): scheduleConfig must be a non-null object, got ${typeof j.scheduleConfig}`
      );
    }
  }
  for (let i = 0; i < data.memories.length; i++) {
    const m = data.memories[i];
    if (!Array.isArray(m.tags)) {
      throw new Error(
        `memories[${i}] (id=${m.id}): tags must be an array, got ${typeof m.tags}`
      );
    }
  }
  for (let i = 0; i < data.messages.length; i++) {
    const msg = data.messages[i];
    for (const field of ["toolCalls", "toolResults", "pendingActions"] as const) {
      const val = msg[field];
      if (val !== null && val !== undefined && typeof val !== "object") {
        throw new Error(
          `messages[${i}] (id=${msg.id}): ${field} must be null or an object, got ${typeof val}`
        );
      }
    }
  }
}

/** Delete all rows in FK-safe reverse order */
export function clearAllData(): void {
  const db = getDb();
  db.delete(runMemories).run();
  db.delete(runConnections).run();
  db.delete(runLogs).run();
  db.delete(dashboardItems).run();
  db.delete(messages).run();
  db.delete(conversations).run();
  db.delete(memories).run();
  db.delete(runs).run();
  db.delete(jobs).run();
  db.delete(goals).run();
  db.delete(connectionScopeBindings).run();
  db.delete(connections).run();
  db.delete(projects).run();
  db.delete(settings).run();
}

/**
 * Validate, clear all tables, then import data — all within a single transaction.
 * Throws before touching the database if any JSON field is malformed.
 */
export function importAllData(data: ExportData): RecordCounts {
  validateImportData(data); // validate before any mutation

  const db = getDb();
  const counts: RecordCounts = {
    projects: 0, goals: 0, jobs: 0, runs: 0, runLogs: 0,
    conversations: 0, messages: 0, dashboardItems: 0, memories: 0,
    runMemories: 0, settings: 0,
  };

  db.transaction((tx) => {
    // Clear all tables first (atomic with inserts — prevents empty-DB on crash between clear and import)
    tx.delete(runMemories).run();
    tx.delete(runConnections).run();
    tx.delete(runLogs).run();
    tx.delete(dashboardItems).run();
    tx.delete(messages).run();
    tx.delete(conversations).run();
    tx.delete(memories).run();
    tx.delete(runs).run();
    tx.delete(jobs).run();
    tx.delete(goals).run();
    tx.delete(connectionScopeBindings).run();
    tx.delete(connections).run();
    tx.delete(projects).run();
    tx.delete(settings).run();

    // 1. Settings
    for (const s of data.settings) {
      tx.insert(settings).values(s).run();
      counts.settings++;
    }
    // 2. Projects
    for (const p of data.projects) {
      tx.insert(projects).values(p).run();
      counts.projects++;
    }
    // 3. Goals
    for (const g of data.goals) {
      tx.insert(goals).values(g).run();
      counts.goals++;
    }
    // 4. Jobs (re-stringify JSON)
    for (const j of data.jobs) {
      tx.insert(jobs).values({
        ...j,
        scheduleConfig: JSON.stringify(j.scheduleConfig),
        isEnabled: j.isEnabled,
        isArchived: j.isArchived,
      }).run();
      counts.jobs++;
    }
    // 5. Runs — null parentRunId first, then rest
    const nullParent = data.runs.filter((r) => !r.parentRunId);
    const withParent = data.runs.filter((r) => !!r.parentRunId);
    for (const r of [...nullParent, ...withParent]) {
      tx.insert(runs).values(r).run();
      counts.runs++;
    }
    // 6. RunLogs
    for (const rl of data.runLogs) {
      tx.insert(runLogs).values(rl).run();
      counts.runLogs++;
    }
    // 7. Conversations
    for (const c of data.conversations) {
      tx.insert(conversations).values(c).run();
      counts.conversations++;
    }
    // 8. Messages (re-stringify JSON)
    for (const m of data.messages) {
      tx.insert(messages).values({
        id: m.id,
        conversationId: m.conversationId,
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls ? JSON.stringify(m.toolCalls) : null,
        toolResults: m.toolResults ? JSON.stringify(m.toolResults) : null,
        pendingActions: m.pendingActions ? JSON.stringify(m.pendingActions) : null,
        createdAt: m.createdAt,
      }).run();
      counts.messages++;
    }
    // 9. Dashboard items
    for (const ii of data.dashboardItems) {
      tx.insert(dashboardItems).values(ii).run();
      counts.dashboardItems++;
    }
    // 10. Memories (re-stringify JSON)
    for (const mem of data.memories) {
      tx.insert(memories).values({
        ...mem,
        tags: JSON.stringify(mem.tags),
        isArchived: mem.isArchived,
      }).run();
      counts.memories++;
    }
    // 11. RunMemories
    for (const rm of data.runMemories) {
      tx.insert(runMemories).values(rm).run();
      counts.runMemories++;
    }
  });

  return counts;
}

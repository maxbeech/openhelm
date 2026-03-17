import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "../init.js";
import { memories, runMemories } from "../schema.js";
import type {
  Memory,
  CreateMemoryParams,
  UpdateMemoryParams,
  ListMemoriesParams,
} from "@openorchestra/shared";

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

export function createMemory(params: CreateMemoryParams, embedding?: number[]): Memory {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const row = db
    .insert(memories)
    .values({
      id,
      projectId: params.projectId,
      goalId: params.goalId ?? null,
      jobId: params.jobId ?? null,
      type: params.type,
      content: params.content,
      sourceType: params.sourceType,
      sourceId: params.sourceId ?? null,
      importance: params.importance ?? 5,
      tags: JSON.stringify(params.tags ?? []),
      embedding: embedding ? JSON.stringify(embedding) : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return rowToMemory(row);
}

export function getMemory(id: string): Memory | null {
  const db = getDb();
  const row = db.select().from(memories).where(eq(memories.id, id)).get();
  return row ? rowToMemory(row) : null;
}

export function listMemories(params: ListMemoriesParams): Memory[] {
  const db = getDb();
  const conditions = [eq(memories.projectId, params.projectId)];

  if (params.type) conditions.push(eq(memories.type, params.type));
  if (params.isArchived !== undefined) {
    conditions.push(eq(memories.isArchived, params.isArchived));
  }

  let results = db
    .select()
    .from(memories)
    .where(and(...conditions))
    .orderBy(desc(memories.updatedAt))
    .all()
    .map(rowToMemory);

  // Tag filter (JSON array in text column)
  if (params.tag) {
    results = results.filter((m) => m.tags.includes(params.tag!));
  }

  // Text search filter
  if (params.search) {
    const q = params.search.toLowerCase();
    results = results.filter((m) => m.content.toLowerCase().includes(q));
  }

  return results;
}

export function updateMemory(params: UpdateMemoryParams, embedding?: number[]): Memory {
  const db = getDb();
  const existing = getMemory(params.id);
  if (!existing) throw new Error(`Memory not found: ${params.id}`);

  const row = db
    .update(memories)
    .set({
      ...(params.content !== undefined && { content: params.content }),
      ...(params.type !== undefined && { type: params.type }),
      ...(params.importance !== undefined && { importance: params.importance }),
      ...(params.tags !== undefined && { tags: JSON.stringify(params.tags) }),
      ...(params.isArchived !== undefined && { isArchived: params.isArchived }),
      ...(embedding !== undefined && { embedding: JSON.stringify(embedding) }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(memories.id, params.id))
    .returning()
    .get();

  return rowToMemory(row);
}

export function deleteMemory(id: string): boolean {
  const db = getDb();
  const result = db.delete(memories).where(eq(memories.id, id)).run();
  return result.changes > 0;
}

export function archiveMemory(id: string): Memory {
  return updateMemory({ id, isArchived: true });
}

/** Bump access count and last_accessed_at for retrieved memories */
export function touchMemories(ids: string[]): void {
  if (ids.length === 0) return;
  const db = getDb();
  const now = new Date().toISOString();
  for (const id of ids) {
    db.update(memories)
      .set({
        accessCount: sql`${memories.accessCount} + 1`,
        lastAccessedAt: now,
      })
      .where(eq(memories.id, id))
      .run();
  }
}

/** Get all active (non-archived) memories for a project with embeddings */
export function getActiveMemoriesWithEmbeddings(projectId: string): Array<Memory & { embedding: number[] | null }> {
  const db = getDb();
  const rows = db
    .select()
    .from(memories)
    .where(and(eq(memories.projectId, projectId), eq(memories.isArchived, false)))
    .all();

  return rows.map((row) => ({
    ...rowToMemory(row),
    embedding: row.embedding ? JSON.parse(row.embedding) : null,
  }));
}

/** Update embedding for a memory */
export function updateMemoryEmbedding(id: string, embedding: number[]): void {
  const db = getDb();
  db.update(memories)
    .set({ embedding: JSON.stringify(embedding) })
    .where(eq(memories.id, id))
    .run();
}

/** Count active memories for a project */
export function countActiveMemories(projectId: string): number {
  const db = getDb();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(memories)
    .where(and(eq(memories.projectId, projectId), eq(memories.isArchived, false)))
    .get();
  return row?.count ?? 0;
}

/** Get all distinct tags used in a project */
export function listTags(projectId: string): string[] {
  const mems = listMemories({ projectId, isArchived: false });
  const tagSet = new Set<string>();
  for (const m of mems) {
    for (const t of m.tags) tagSet.add(t);
  }
  return [...tagSet].sort();
}

// ─── Run-Memory association ───

export function saveRunMemories(runId: string, memoryIds: string[]): void {
  if (memoryIds.length === 0) return;
  const db = getDb();
  for (const memoryId of memoryIds) {
    db.insert(runMemories)
      .values({ runId, memoryId })
      .onConflictDoNothing()
      .run();
  }
}

export function listMemoriesForRun(runId: string): Memory[] {
  const db = getDb();
  const rows = db
    .select({ memory: memories })
    .from(runMemories)
    .innerJoin(memories, eq(runMemories.memoryId, memories.id))
    .where(eq(runMemories.runId, runId))
    .all();
  return rows.map((r) => rowToMemory(r.memory));
}

// ─── Cross-project queries (All Projects mode) ───

/** List memories across all projects with optional filters */
export function listAllMemories(params?: Omit<ListMemoriesParams, "projectId">): Memory[] {
  const db = getDb();
  const conditions: ReturnType<typeof eq>[] = [];

  if (params?.type) conditions.push(eq(memories.type, params.type));
  if (params?.isArchived !== undefined) {
    conditions.push(eq(memories.isArchived, params.isArchived));
  }

  let results = db
    .select()
    .from(memories)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(memories.updatedAt))
    .all()
    .map(rowToMemory);

  if (params?.tag) {
    results = results.filter((m) => m.tags.includes(params.tag!));
  }
  if (params?.search) {
    const q = params.search.toLowerCase();
    results = results.filter((m) => m.content.toLowerCase().includes(q));
  }
  return results;
}

/** Count all active memories across all projects */
export function countAllActiveMemories(): number {
  const db = getDb();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(memories)
    .where(eq(memories.isArchived, false))
    .get();
  return row?.count ?? 0;
}

/** Get all distinct tags across all projects */
export function listAllTags(): string[] {
  const mems = listAllMemories({ isArchived: false });
  const tagSet = new Set<string>();
  for (const m of mems) {
    for (const t of m.tags) tagSet.add(t);
  }
  return [...tagSet].sort();
}

/** Batch archive memories by IDs */
export function archiveMemories(ids: string[]): void {
  if (ids.length === 0) return;
  const db = getDb();
  const now = new Date().toISOString();
  for (const id of ids) {
    db.update(memories)
      .set({ isArchived: true, updatedAt: now })
      .where(eq(memories.id, id))
      .run();
  }
}

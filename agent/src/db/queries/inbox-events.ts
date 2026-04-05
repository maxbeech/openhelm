import { eq, and, desc, asc, lt, gt, gte, sql, count as drizzleCount } from "drizzle-orm";
import { getDb } from "../init.js";
import { inboxEvents } from "../schema.js";
import type {
  InboxEvent,
  InboxEventStatus,
  CreateInboxEventParams,
  ListInboxEventsParams,
} from "@openhelm/shared";

function rowToInboxEvent(row: typeof inboxEvents.$inferSelect): InboxEvent {
  return {
    id: row.id,
    projectId: row.projectId ?? null,
    category: row.category as InboxEvent["category"],
    eventType: row.eventType,
    importance: row.importance,
    title: row.title,
    body: row.body ?? null,
    sourceId: row.sourceId ?? null,
    sourceType: (row.sourceType as InboxEvent["sourceType"]) ?? null,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    conversationId: row.conversationId ?? null,
    replyToEventId: row.replyToEventId ?? null,
    status: row.status as InboxEventStatus,
    resolvedAt: row.resolvedAt ?? null,
    eventAt: row.eventAt,
    createdAt: row.createdAt,
  };
}

export function createInboxEvent(params: CreateInboxEventParams): InboxEvent {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const row = db
    .insert(inboxEvents)
    .values({
      id,
      projectId: params.projectId,
      category: params.category,
      eventType: params.eventType,
      importance: params.importance,
      title: params.title,
      body: params.body ?? null,
      sourceId: params.sourceId ?? null,
      sourceType: params.sourceType ?? null,
      metadata: JSON.stringify(params.metadata ?? {}),
      conversationId: params.conversationId ?? null,
      replyToEventId: params.replyToEventId ?? null,
      eventAt: params.eventAt ?? now,
      createdAt: now,
    })
    .returning()
    .get();

  return rowToInboxEvent(row);
}

export function getInboxEvent(id: string): InboxEvent | null {
  const db = getDb();
  const row = db
    .select()
    .from(inboxEvents)
    .where(eq(inboxEvents.id, id))
    .get();
  return row ? rowToInboxEvent(row) : null;
}

export function listInboxEvents(params: ListInboxEventsParams = {}): InboxEvent[] {
  const db = getDb();
  const conditions = [];
  const limit = params.limit ?? 50;

  if (params.projectId) {
    conditions.push(eq(inboxEvents.projectId, params.projectId));
  }
  if (params.category) {
    conditions.push(eq(inboxEvents.category, params.category));
  }
  if (params.status) {
    conditions.push(eq(inboxEvents.status, params.status));
  }
  if (params.minImportance != null) {
    conditions.push(gte(inboxEvents.importance, params.minImportance));
  }
  if (params.before) {
    conditions.push(lt(inboxEvents.eventAt, params.before));
  }
  if (params.after) {
    conditions.push(gt(inboxEvents.eventAt, params.after));
  }

  // When loading past (before cursor), sort DESC and return
  // When loading future (after cursor), sort ASC then reverse isn't needed — caller handles
  const isForward = !!params.after && !params.before;

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = db
    .select()
    .from(inboxEvents)
    .where(whereClause)
    .orderBy(isForward ? asc(inboxEvents.eventAt) : desc(inboxEvents.eventAt))
    .limit(limit)
    .all()
    .map(rowToInboxEvent);

  // DESC queries (loading past) need reversal to maintain chronological order (oldest first)
  // ASC queries (loading future) are already in order
  return isForward ? rows : rows.reverse();
}

export function resolveInboxEvent(
  id: string,
  status: "resolved" | "dismissed",
): InboxEvent {
  const db = getDb();
  const now = new Date().toISOString();
  const row = db
    .update(inboxEvents)
    .set({ status, resolvedAt: now })
    .where(eq(inboxEvents.id, id))
    .returning()
    .get();
  if (!row) throw new Error(`Inbox event not found: ${id}`);
  return rowToInboxEvent(row);
}

/** Resolve inbox events by source (e.g., when a dashboard item is resolved) */
export function resolveInboxEventBySource(
  sourceType: string,
  sourceId: string,
  status: "resolved" | "dismissed",
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.update(inboxEvents)
    .set({ status, resolvedAt: now })
    .where(
      and(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        eq(inboxEvents.sourceType, sourceType as any),
        eq(inboxEvents.sourceId, sourceId),
        eq(inboxEvents.status, "active"),
      ),
    )
    .run();
}

export function countInboxEvents(params: {
  projectId?: string | null;
  status?: InboxEventStatus;
  minImportance?: number;
} = {}): number {
  const db = getDb();
  const conditions = [];

  if (params.projectId) {
    conditions.push(eq(inboxEvents.projectId, params.projectId));
  }
  if (params.status) {
    conditions.push(eq(inboxEvents.status, params.status));
  }
  if (params.minImportance != null) {
    conditions.push(gte(inboxEvents.importance, params.minImportance));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(inboxEvents)
    .where(whereClause)
    .get();
  return row?.count ?? 0;
}

/**
 * Upsert a conversation thread event — one active event per conversation.
 * Replaces the existing active event for the same conversation (if any) by
 * resolving it first, then inserts a fresh event with the latest message.
 */
export function upsertConversationThreadEvent(params: CreateInboxEventParams): InboxEvent {
  const db = getDb();
  // Resolve-then-insert wrapped in a transaction so the conversation is never
  // left without an active event (old resolved, new not yet created).
  return db.transaction((tx) => {
    if (params.conversationId) {
      tx.update(inboxEvents)
        .set({ status: "resolved", resolvedAt: new Date().toISOString() })
        .where(
          and(
            eq(inboxEvents.conversationId, params.conversationId),
            eq(inboxEvents.eventType, "chat.conversation_thread"),
            eq(inboxEvents.status, "active"),
          ),
        )
        .run();
    }
    return createInboxEvent(params);
  });
}

/** Check if an inbox event already exists for a given source (used for backfill dedup) */
export function hasInboxEventForSource(sourceType: string, sourceId: string): boolean {
  const db = getDb();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(inboxEvents)
    .where(
      and(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        eq(inboxEvents.sourceType, sourceType as any),
        eq(inboxEvents.sourceId, sourceId),
      ),
    )
    .get();
  return (row?.count ?? 0) > 0;
}

/** Get all importances in a time range for tier computation */
export function listImportancesInRange(
  projectId: string | null,
  from: string,
  to: string,
): number[] {
  const db = getDb();
  const conditions = [
    gte(inboxEvents.eventAt, from),
    lt(inboxEvents.eventAt, to),
  ];
  if (projectId) {
    conditions.push(eq(inboxEvents.projectId, projectId));
  }
  return db
    .select({ importance: inboxEvents.importance })
    .from(inboxEvents)
    .where(and(...conditions))
    .all()
    .map((r) => r.importance);
}

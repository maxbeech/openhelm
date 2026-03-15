import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../init.js";
import { inboxItems } from "../schema.js";
import type {
  InboxItem,
  InboxItemStatus,
  CreateInboxItemParams,
  ListInboxItemsParams,
} from "@openorchestra/shared";

function rowToInboxItem(row: typeof inboxItems.$inferSelect): InboxItem {
  return {
    ...row,
    resolvedAt: row.resolvedAt ?? null,
  } as InboxItem;
}

export function createInboxItem(params: CreateInboxItemParams): InboxItem {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const row = db
    .insert(inboxItems)
    .values({
      id,
      runId: params.runId,
      jobId: params.jobId,
      projectId: params.projectId,
      type: params.type,
      title: params.title,
      message: params.message,
      createdAt: now,
    })
    .returning()
    .get();

  return rowToInboxItem(row);
}

export function getInboxItem(id: string): InboxItem | null {
  const db = getDb();
  const row = db
    .select()
    .from(inboxItems)
    .where(eq(inboxItems.id, id))
    .get();
  return row ? rowToInboxItem(row) : null;
}

export function listInboxItems(params?: ListInboxItemsParams): InboxItem[] {
  const db = getDb();
  const conditions = [];

  if (params?.projectId) {
    conditions.push(eq(inboxItems.projectId, params.projectId));
  }
  if (params?.status) {
    conditions.push(eq(inboxItems.status, params.status));
  }

  const query =
    conditions.length > 0
      ? db
          .select()
          .from(inboxItems)
          .where(and(...conditions))
      : db.select().from(inboxItems);

  return query
    .orderBy(desc(inboxItems.createdAt))
    .all()
    .map(rowToInboxItem);
}

export function resolveInboxItem(
  id: string,
  status: InboxItemStatus,
): InboxItem {
  const db = getDb();
  const now = new Date().toISOString();
  const row = db
    .update(inboxItems)
    .set({ status, resolvedAt: now })
    .where(eq(inboxItems.id, id))
    .returning()
    .get();
  if (!row) {
    throw new Error(`Inbox item not found: ${id}`);
  }
  return rowToInboxItem(row);
}

export function countOpenInboxItems(projectId?: string): number {
  const db = getDb();
  const conditions = [eq(inboxItems.status, "open")];
  if (projectId) {
    conditions.push(eq(inboxItems.projectId, projectId));
  }

  const rows = db
    .select()
    .from(inboxItems)
    .where(and(...conditions))
    .all();
  return rows.length;
}

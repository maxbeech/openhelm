import { eq, ne, desc, lt, and, isNull, or, asc } from "drizzle-orm";
import { getDb } from "../init.js";
import { conversations, messages } from "../schema.js";
import type {
  Conversation,
  ChatMessage,
  ChatToolCall,
  ChatToolResult,
  PendingAction,
} from "@openhelm/shared";

function rowToConversation(row: typeof conversations.$inferSelect): Conversation {
  return {
    id: row.id,
    projectId: row.projectId ?? null,
    channel: row.channel as Conversation["channel"],
    title: row.title ?? null,
    sortOrder: row.sortOrder ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToMessage(row: typeof messages.$inferSelect): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as ChatMessage["role"],
    content: row.content,
    toolCalls: row.toolCalls ? (JSON.parse(row.toolCalls) as ChatToolCall[]) : null,
    toolResults: row.toolResults ? (JSON.parse(row.toolResults) as ChatToolResult[]) : null,
    pendingActions: row.pendingActions ? (JSON.parse(row.pendingActions) as PendingAction[]) : null,
    createdAt: row.createdAt,
  };
}

/** Build the WHERE clause for finding conversations by projectId (null-safe). */
function projectIdCondition(projectId: string | null) {
  return projectId === null
    ? isNull(conversations.projectId)
    : eq(conversations.projectId, projectId);
}

/** Get a conversation by ID, or fall back to the first for a project (creating one if needed). */
export function getOrCreateConversation(
  projectId: string | null,
  conversationId?: string,
): Conversation {
  const db = getDb();

  // If a specific conversation is requested, return it directly
  if (conversationId) {
    const row = db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
    if (row) return rowToConversation(row);
    // Fall through to project-based lookup if not found
  }

  const existing = db
    .select()
    .from(conversations)
    .where(and(projectIdCondition(projectId), ne(conversations.channel, "inbox")))
    .orderBy(asc(conversations.sortOrder), asc(conversations.createdAt))
    .get();
  if (existing) return rowToConversation(existing);

  const now = new Date().toISOString();
  const row = db
    .insert(conversations)
    .values({ id: crypto.randomUUID(), projectId, channel: "app", sortOrder: 0, createdAt: now, updatedAt: now })
    .returning()
    .get();
  return rowToConversation(row);
}

/** List all conversation threads for a project, ordered by sortOrder.
 *  Excludes inbox-channel conversations (they have their own UI surface). */
export function listConversationsForProject(projectId: string | null): Conversation[] {
  const db = getDb();
  return db
    .select()
    .from(conversations)
    .where(and(projectIdCondition(projectId), ne(conversations.channel, "inbox")))
    .orderBy(asc(conversations.sortOrder), asc(conversations.createdAt))
    .all()
    .map(rowToConversation);
}

/** Get a single conversation by ID. */
export function getConversation(conversationId: string): Conversation | null {
  const db = getDb();
  const row = db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
  return row ? rowToConversation(row) : null;
}

/** Create a new conversation thread. */
export function createConversation(projectId: string | null, title?: string): Conversation {
  const db = getDb();
  const now = new Date().toISOString();
  // Place new thread at end: max sortOrder + 1
  const maxRow = db
    .select({ sortOrder: conversations.sortOrder })
    .from(conversations)
    .where(projectIdCondition(projectId))
    .orderBy(desc(conversations.sortOrder))
    .get();
  const nextOrder = (maxRow?.sortOrder ?? -1) + 1;

  const row = db
    .insert(conversations)
    .values({ id: crypto.randomUUID(), projectId, channel: "app", title: title ?? null, sortOrder: nextOrder, createdAt: now, updatedAt: now })
    .returning()
    .get();
  return rowToConversation(row);
}

/** Rename a conversation thread. */
export function renameConversation(conversationId: string, title: string): Conversation {
  const db = getDb();
  const now = new Date().toISOString();
  const row = db
    .update(conversations)
    .set({ title, updatedAt: now })
    .where(eq(conversations.id, conversationId))
    .returning()
    .get();
  if (!row) throw new Error(`Conversation not found: ${conversationId}`);
  return rowToConversation(row);
}

/** Delete a conversation thread (messages cascade-delete). */
export function deleteConversation(conversationId: string): void {
  const db = getDb();
  db.delete(conversations).where(eq(conversations.id, conversationId)).run();
}

/** Reorder conversations — each ID's index becomes its new sortOrder. */
export function reorderConversations(conversationIds: string[]): void {
  const db = getDb();
  const now = new Date().toISOString();
  // Wrapped in a transaction so a partial failure doesn't leave inconsistent sort order.
  db.transaction((tx) => {
    for (let i = 0; i < conversationIds.length; i++) {
      tx.update(conversations)
        .set({ sortOrder: i, updatedAt: now })
        .where(eq(conversations.id, conversationIds[i]))
        .run();
    }
  });
}

/** Create and persist a chat message. Also touches the parent conversation's updatedAt. */
export function createMessage(params: {
  conversationId: string;
  role: ChatMessage["role"];
  content: string;
  toolCalls?: ChatToolCall[];
  toolResults?: ChatToolResult[];
  pendingActions?: PendingAction[];
}): ChatMessage {
  const db = getDb();
  const now = new Date().toISOString();
  // Touch parent conversation updatedAt for thread ordering freshness
  db.update(conversations)
    .set({ updatedAt: now })
    .where(eq(conversations.id, params.conversationId))
    .run();
  const row = db
    .insert(messages)
    .values({
      id: crypto.randomUUID(),
      conversationId: params.conversationId,
      role: params.role,
      content: params.content,
      toolCalls: params.toolCalls ? JSON.stringify(params.toolCalls) : null,
      toolResults: params.toolResults ? JSON.stringify(params.toolResults) : null,
      pendingActions: params.pendingActions ? JSON.stringify(params.pendingActions) : null,
      createdAt: now,
    })
    .returning()
    .get();
  return rowToMessage(row);
}

/** Update the pending_actions field on an existing message. */
export function updateMessagePendingActions(
  messageId: string,
  pendingActions: PendingAction[],
): ChatMessage {
  const db = getDb();
  const row = db
    .update(messages)
    .set({ pendingActions: JSON.stringify(pendingActions) })
    .where(eq(messages.id, messageId))
    .returning()
    .get();
  if (!row) throw new Error(`Message not found: ${messageId}`);
  return rowToMessage(row);
}

/** Get a message by ID. */
export function getMessage(id: string): ChatMessage | null {
  const db = getDb();
  const row = db.select().from(messages).where(eq(messages.id, id)).get();
  return row ? rowToMessage(row) : null;
}

/** List messages for a conversation by conversationId directly. */
export function listMessagesForConversation(
  conversationId: string,
  limit = 100,
  beforeId?: string,
): ChatMessage[] {
  const db = getDb();
  const conditions = [eq(messages.conversationId, conversationId)];
  if (beforeId) {
    const ref = db.select().from(messages).where(eq(messages.id, beforeId)).get();
    if (ref) {
      // Compound cursor: same timestamp ties broken by id (both desc — matches orderBy)
      conditions.push(
        or(
          lt(messages.createdAt, ref.createdAt),
          and(eq(messages.createdAt, ref.createdAt), lt(messages.id, ref.id))!,
        )!,
      );
    }
  }
  const rows = db
    .select()
    .from(messages)
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit)
    .all();
  return rows.map(rowToMessage).reverse();
}

/** List messages for a project's default conversation (backward compat). */
export function listMessagesForProject(
  projectId: string | null,
  limit = 100,
  beforeId?: string,
): ChatMessage[] {
  const db = getDb();
  const conv = db
    .select()
    .from(conversations)
    .where(projectIdCondition(projectId))
    .orderBy(asc(conversations.sortOrder), asc(conversations.createdAt))
    .get();
  if (!conv) return [];
  return listMessagesForConversation(conv.id, limit, beforeId);
}

/** Derive the projectId for a message by joining through its conversation. */
export function getProjectIdForMessage(messageId: string): string | null {
  const db = getDb();
  const row = db
    .select({ projectId: conversations.projectId })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(eq(messages.id, messageId))
    .get();
  return row?.projectId ?? null;
}

/** Clear all messages for a specific conversation, or by project fallback. */
export function clearConversation(projectId: string | null, conversationId?: string): void {
  const db = getDb();
  if (conversationId) {
    db.delete(messages).where(eq(messages.conversationId, conversationId)).run();
    return;
  }
  const conv = db
    .select()
    .from(conversations)
    .where(projectIdCondition(projectId))
    .orderBy(asc(conversations.sortOrder), asc(conversations.createdAt))
    .get();
  if (!conv) return;
  db.delete(messages).where(eq(messages.conversationId, conv.id)).run();
}

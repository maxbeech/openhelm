import { eq, desc, lt, and } from "drizzle-orm";
import { getDb } from "../init.js";
import { conversations, messages } from "../schema.js";
import type {
  Conversation,
  ChatMessage,
  ChatToolCall,
  ChatToolResult,
  PendingAction,
} from "@openorchestra/shared";

function rowToConversation(row: typeof conversations.$inferSelect): Conversation {
  return {
    id: row.id,
    projectId: row.projectId,
    channel: row.channel as Conversation["channel"],
    title: row.title ?? null,
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

/** Get the single active conversation for a project, or create one. */
export function getOrCreateConversation(projectId: string): Conversation {
  const db = getDb();
  const existing = db
    .select()
    .from(conversations)
    .where(eq(conversations.projectId, projectId))
    .get();
  if (existing) return rowToConversation(existing);

  const now = new Date().toISOString();
  const row = db
    .insert(conversations)
    .values({ id: crypto.randomUUID(), projectId, channel: "app", createdAt: now, updatedAt: now })
    .returning()
    .get();
  return rowToConversation(row);
}

/** Create and persist a chat message. */
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

/** List messages for a project's conversation, newest-first with optional pagination. */
export function listMessagesForProject(
  projectId: string,
  limit = 100,
  beforeId?: string,
): ChatMessage[] {
  const db = getDb();
  const conv = db
    .select()
    .from(conversations)
    .where(eq(conversations.projectId, projectId))
    .get();
  if (!conv) return [];

  const conditions = [eq(messages.conversationId, conv.id)];

  if (beforeId) {
    const ref = db.select().from(messages).where(eq(messages.id, beforeId)).get();
    if (ref) conditions.push(lt(messages.createdAt, ref.createdAt));
  }

  const rows = db
    .select()
    .from(messages)
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
    .all();

  // Return in chronological order
  return rows.map(rowToMessage).reverse();
}

/** Delete all messages for a project's conversation (clear chat). */
export function clearConversation(projectId: string): void {
  const db = getDb();
  const conv = db
    .select()
    .from(conversations)
    .where(eq(conversations.projectId, projectId))
    .get();
  if (!conv) return;
  db.delete(messages).where(eq(messages.conversationId, conv.id)).run();
}

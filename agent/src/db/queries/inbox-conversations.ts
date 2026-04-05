/**
 * Helper for the special per-project "inbox" conversation channel.
 * These conversations are never shown in the sidebar chat thread list.
 */

import { eq, and, isNull } from "drizzle-orm";
import { getDb } from "../init.js";
import { conversations } from "../schema.js";
import type { Conversation } from "@openhelm/shared";

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

/**
 * Get or create the inbox conversation for a project (or "All Projects" if null).
 * Uses channel='inbox' to distinguish from regular app conversations.
 */
export function getOrCreateInboxConversation(projectId: string | null): Conversation {
  const db = getDb();

  const condition = projectId
    ? and(eq(conversations.channel, "inbox"), eq(conversations.projectId, projectId))
    : and(eq(conversations.channel, "inbox"), isNull(conversations.projectId));

  // Wrapped in a transaction with a post-insert re-check to handle the
  // select-then-insert race: concurrent callers may both see no existing row
  // and both attempt to insert. The re-check returns the winner's row.
  return db.transaction((tx) => {
    const existing = tx.select().from(conversations).where(condition).get();
    if (existing) return rowToConversation(existing);

    const now = new Date().toISOString();
    const inserted = tx
      .insert(conversations)
      .values({
        id: crypto.randomUUID(),
        projectId,
        channel: "inbox",
        title: "Inbox",
        sortOrder: -1, // hidden from normal sort
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    return rowToConversation(inserted);
  });
}

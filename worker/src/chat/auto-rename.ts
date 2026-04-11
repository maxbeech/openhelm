/**
 * Auto-rename a newly-started chat thread based on the first user message.
 *
 * Fire-and-forget: failures are swallowed silently so a rename error never
 * blocks a chat response. Mirrors the agent's autoRenameThread logic.
 */

import { getSupabase } from "../supabase.js";
import { llmCall } from "../llm-router.js";

const RENAME_SYSTEM_PROMPT =
  "You generate short, descriptive chat thread titles. Return ONLY the title — no quotes, no explanation, no punctuation at the end. Max 6 words.";

export async function autoRenameThread(
  conversationId: string,
  userContent: string,
  userId: string,
): Promise<void> {
  try {
    const response = await llmCall({
      userId,
      callType: "chat",
      model: "haiku",
      systemPrompt: RENAME_SYSTEM_PROMPT,
      userMessage: `Generate a concise title for a chat thread that starts with:\n\n"${userContent.slice(0, 300)}"`,
      maxTokens: 24,
    });

    const title = response.text
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[.!?]+$/, "")
      .slice(0, 80);

    if (!title) return;

    const supabase = getSupabase();
    const { error } = await supabase
      .from("conversations")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("user_id", userId);
    if (error) {
      console.error(`[auto-rename] failed to update conversation ${conversationId}: ${error.message}`);
      return;
    }

    // Broadcast so the frontend sidebar updates without polling
    const channel = supabase.channel(`user:${userId}:events`);
    await channel.send({
      type: "broadcast",
      event: "chat.threadRenamed",
      payload: { conversationId, title },
    }).catch((err: Error) => {
      console.error(`[auto-rename] broadcast failed: ${err.message}`);
    });
    supabase.removeChannel(channel);
  } catch (err) {
    console.error(
      `[auto-rename] failed for conversation ${conversationId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

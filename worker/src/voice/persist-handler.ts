/**
 * Voice persist handler — stores voice turns as rows in the `messages` table
 * so they appear in the same conversation thread as typed turns. Also
 * broadcasts the new message on the user's event channel so an open chat
 * view updates without a reload.
 *
 * Called from the browser after each completed turn:
 *   - role 'user'      when conversation.item.input_audio_transcription.completed fires
 *   - role 'assistant' when response.audio_transcript.done fires
 *
 * The browser is responsible for batching and de-duping — the worker trusts
 * it on message ordering within a session. Multi-tenant safety is enforced
 * via voice_sessions.user_id + conversation ownership checks.
 */

import { getSupabase } from "../supabase.js";

export interface VoicePersistTurnParams {
  voiceSessionId: string;
  role: "user" | "assistant";
  content: string;
  /** Optional tool calls from the assistant turn (already-executed). */
  toolCalls?: unknown;
  toolResults?: unknown;
}

export interface VoicePersistTurnResult {
  messageId: string;
  conversationId: string;
}

export async function handleVoicePersistTurn(
  params: VoicePersistTurnParams,
  userId: string,
): Promise<VoicePersistTurnResult> {
  const supabase = getSupabase();

  // Resolve the conversation this voice session is attached to. If none was
  // set at session-start time, the persist call is a no-op (caller should
  // have attached one before persisting).
  const { data: session, error: sessionErr } = await supabase
    .from("voice_sessions")
    .select("id, user_id, conversation_id")
    .eq("id", params.voiceSessionId)
    .eq("user_id", userId)
    .single();

  if (sessionErr || !session) {
    throw new Error("voice_session_not_found");
  }
  if (!session.conversation_id) {
    throw new Error("voice_session_has_no_conversation");
  }

  // Defence in depth — verify the conversation belongs to the same user.
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, user_id")
    .eq("id", session.conversation_id)
    .single();
  if (!conv || conv.user_id !== userId) {
    throw new Error("conversation_not_owned_by_user");
  }

  const messageId = crypto.randomUUID();
  const now = new Date().toISOString();

  const row = {
    id: messageId,
    user_id: userId,
    conversation_id: session.conversation_id,
    role: params.role,
    content: params.content,
    tool_calls: params.toolCalls ?? null,
    tool_results: params.toolResults ?? null,
    pending_actions: null,
    voice_session_id: params.voiceSessionId,
    created_at: now,
  };

  const { error: insertErr } = await supabase.from("messages").insert(row);
  if (insertErr) {
    throw new Error(`[voice-persist] insert failed: ${insertErr.message}`);
  }

  // Broadcast to the user's channel so any open chat view picks it up.
  // Fire-and-forget — persistence is the source of truth, realtime fan-out
  // is UX sugar.
  const channel = supabase.channel(`user:${userId}:events`);
  await channel
    .send({
      type: "broadcast",
      event: "chat.messageCreated",
      payload: {
        id: messageId,
        conversationId: session.conversation_id,
        role: params.role,
        content: params.content,
        toolCalls: params.toolCalls ?? null,
        toolResults: params.toolResults ?? null,
        pendingActions: null,
        createdAt: now,
        voiceSessionId: params.voiceSessionId,
      },
    })
    .catch((err: Error) => {
      console.error("[voice-persist] broadcast failed (non-fatal):", err.message);
    });
  supabase.removeChannel(channel);

  // Bump conversations.updated_at so the sidebar re-sorts.
  await supabase
    .from("conversations")
    .update({ updated_at: now })
    .eq("id", session.conversation_id);

  return { messageId, conversationId: session.conversation_id };
}

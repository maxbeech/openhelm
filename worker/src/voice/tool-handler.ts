/**
 * Voice tool handler — called from the browser when the Realtime session
 * emits a function_call_arguments.done event. Wraps the existing chat
 * tool executor with:
 *   1. Ownership check — voice_sessions.user_id must match the caller
 *   2. Whitelist check — tool name must be in the session's permission mode
 *      tool set, not whatever the browser happens to send
 *   3. tool_call_count increment on the voice_sessions row
 *
 * Returns the raw tool result as a plain object so the browser can send it
 * back to the Realtime session as a function_call_output item.
 */

import { getSupabase } from "../supabase.js";
import { executeToolCall } from "../chat/tool-executor.js";
import { getToolsForMode } from "../chat/tool-schemas.js";

export interface VoiceToolExecuteParams {
  voiceSessionId: string;
  callId: string;
  name: string;
  /** Arguments as JSON string (as delivered by Realtime) or already-parsed object. */
  arguments: unknown;
}

export interface VoiceToolExecuteResult {
  callId: string;
  result: unknown;
}

export async function handleVoiceToolExecute(
  params: VoiceToolExecuteParams,
  userId: string,
): Promise<VoiceToolExecuteResult> {
  const supabase = getSupabase();

  // Verify the session belongs to this user and is still active.
  const { data: session, error: sessionErr } = await supabase
    .from("voice_sessions")
    .select("id, user_id, permission_mode, status")
    .eq("id", params.voiceSessionId)
    .eq("user_id", userId)
    .single();

  if (sessionErr || !session) {
    throw new Error("voice_session_not_found");
  }
  if (session.status !== "active") {
    throw new Error(`voice_session_not_active: ${session.status}`);
  }

  // Whitelist — browser cannot invoke tools outside the permission mode it
  // was minted with, even if it mutates session.tools via session.update.
  const allowedNames = new Set(
    getToolsForMode(session.permission_mode as string)
      .filter((t): t is Extract<typeof t, { type: "function" }> => t.type === "function")
      .map((t) => t.function.name),
  );
  if (!allowedNames.has(params.name)) {
    throw new Error(`voice_tool_not_allowed: ${params.name}`);
  }

  // Parse arguments — Realtime delivers JSON strings, but we accept objects
  // too for future-proofing and easier testing.
  let args: Record<string, unknown>;
  if (typeof params.arguments === "string") {
    try {
      args = JSON.parse(params.arguments || "{}") as Record<string, unknown>;
    } catch {
      throw new Error("voice_tool_invalid_arguments_json");
    }
  } else if (params.arguments && typeof params.arguments === "object") {
    args = params.arguments as Record<string, unknown>;
  } else {
    args = {};
  }

  const result = await executeToolCall(params.name, args, userId);

  // Fire-and-forget tool_call_count increment. Doesn't block the response —
  // the UI will show it on the next usage fetch.
  void supabase.rpc("increment_voice_session_tool_count", {
    p_session_id: params.voiceSessionId,
  }).then(({ error }) => {
    if (error) {
      // RPC may not exist yet — fall back to a direct UPDATE. Non-fatal.
      void supabase
        .from("voice_sessions")
        .select("tool_call_count")
        .eq("id", params.voiceSessionId)
        .single()
        .then(({ data }) => {
          if (data) {
            void supabase
              .from("voice_sessions")
              .update({ tool_call_count: (data.tool_call_count ?? 0) + 1 })
              .eq("id", params.voiceSessionId);
          }
        });
    }
  });

  return { callId: params.callId, result };
}

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
    .select("id, user_id, project_id, permission_mode, status")
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

  // Default projectId from the session's active project when the LLM
  // omits it — voice users rarely name a project_id out loud, so relying
  // on the model to pass the id correctly is fragile. The session-scoped
  // project is the single source of truth while the session is live.
  const sessionProjectId = (session as { project_id?: string | null }).project_id ?? null;
  if (
    sessionProjectId &&
    !args.projectId &&
    (params.name === "create_goal" ||
      params.name === "create_job" ||
      params.name === "list_goals" ||
      params.name === "list_jobs")
  ) {
    args.projectId = sessionProjectId;
  }

  const result = await executeToolCall(params.name, args, userId);

  // Broadcast a realtime refresh signal so open dashboards / sidebars pick
  // up newly created or archived rows without a manual reload. We only fire
  // on write tools; read tools don't mutate state so there's nothing to
  // refetch. Fire-and-forget — if the realtime channel is unhealthy the
  // broadcast quietly fails, a reload will still show the row.
  const isWriteTool =
    params.name === "create_job" ||
    params.name === "archive_job" ||
    params.name === "create_goal" ||
    params.name === "archive_goal";
  if (isWriteTool) {
    void broadcastWriteSignal(params.name, userId, result);
  }

  // Fire-and-forget tool_call_count increment. Doesn't block the response —
  // the UI will show it on the next usage fetch.
  incrementVoiceToolCount(params.voiceSessionId);

  return { callId: params.callId, result };
}

/** Increment tool_call_count on the voice session, with fallback to direct
 *  UPDATE if the increment_voice_session_tool_count RPC doesn't exist yet. */
async function incrementVoiceToolCount(voiceSessionId: string): Promise<void> {
  const supabase = getSupabase();
  try {
    const { error } = await supabase.rpc("increment_voice_session_tool_count", {
      p_session_id: voiceSessionId,
    });
    if (!error) return;

    // RPC may not exist in older Supabase instances — fall back to a direct UPDATE.
    const { data } = await supabase
      .from("voice_sessions")
      .select("tool_call_count")
      .eq("id", voiceSessionId)
      .single();

    if (data) {
      await supabase
        .from("voice_sessions")
        .update({ tool_call_count: (data.tool_call_count ?? 0) + 1 })
        .eq("id", voiceSessionId);
    }
  } catch (err) {
    // Non-fatal — voice session continues even if count fails to increment.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[voice-tool] tool_call_count increment failed (non-fatal): ${msg}`);
  }
}

/** Send a broadcast on the user's realtime channel so the chat panel and
 *  sidebars can refetch jobs/goals immediately after a voice-driven write.
 *  Event name mirrors the existing `job.updated` handler already wired in
 *  App.tsx; `goal.updated` is new and handled alongside it. */
async function broadcastWriteSignal(
  toolName: string,
  userId: string,
  result: unknown,
): Promise<void> {
  const event =
    toolName === "create_job" || toolName === "archive_job"
      ? "job.updated"
      : "goal.updated";
  const payload = { source: "voice", tool: toolName, result };
  try {
    const supabase = getSupabase();
    const channel = supabase.channel(`user:${userId}:events`);
    await channel.send({ type: "broadcast", event, payload });
    supabase.removeChannel(channel);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[voice-tool] broadcast ${event} failed (non-fatal):`, msg);
  }
}

/**
 * Chat Handler — processes chat.send and chat.cancel RPC calls.
 *
 * Flow for chat.send:
 *  1. Insert the user message row.
 *  2. Load recent conversation history.
 *  3. Build tool schemas + system prompt based on permissionMode.
 *  4. Run the tool loop (LLM → tools → LLM → ...) to produce the final reply.
 *  5. Insert the assistant message row (including tool_calls and tool_results).
 *  6. Update conversations.updated_at and auto-rename on first message.
 *  7. Broadcast both messages via Supabase Realtime.
 */

import { getSupabase } from "./supabase.js";
import { runChatToolLoop } from "./chat/tool-loop.js";
import { getToolsForMode } from "./chat/tool-schemas.js";
import { buildCloudChatSystemPrompt } from "./chat/system-prompt.js";
import { autoRenameThread } from "./chat/auto-rename.js";
import { recordDemoMessage } from "./demo-rate-limit.js";
import { calculateRawCostUsd } from "./cost-calculator.js";

const MAX_HISTORY_MESSAGES = 50;
const DEFAULT_CHAT_MODEL = "haiku";

interface ChatSendParams {
  conversationId: string;
  content: string;
  model?: string;
  modelEffort?: string;
  permissionMode?: string;
  context?: unknown;
  /**
   * Present only for anonymous demo visitors. Signals the handler to
   * meter the message against the per-session / per-IP / global budgets
   * after the LLM call completes successfully.
   */
  demoContext?: {
    slug: string;
    ipHash: string;
  };
}

interface MessageRow {
  id: string;
  user_id: string;
  conversation_id: string;
  role: string;
  content: string;
  tool_calls: unknown;
  tool_results: unknown;
  pending_actions: unknown;
  created_at: string;
}

export async function handleChatSend(
  params: ChatSendParams,
  userId: string,
): Promise<{ started: boolean }> {
  const supabase = getSupabase();
  const { conversationId, content, model, permissionMode } = params;
  const mode = permissionMode ?? "plan";
  const now = new Date().toISOString();

  // 1. Insert user message
  const userMsgId = crypto.randomUUID();
  const { data: userMsg, error: userInsertErr } = await supabase
    .from("messages")
    .insert({
      id: userMsgId,
      user_id: userId,
      conversation_id: conversationId,
      role: "user",
      content,
      tool_calls: null,
      tool_results: null,
      pending_actions: null,
      created_at: now,
    })
    .select()
    .single<MessageRow>();

  if (userInsertErr) {
    throw new Error(`[chat-handler] Failed to insert user message: ${userInsertErr.message}`);
  }

  // 2. Load recent history
  const { data: historyRows, error: historyErr } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true })
    .limit(MAX_HISTORY_MESSAGES);

  if (historyErr) {
    throw new Error(`[chat-handler] Failed to load history: ${historyErr.message}`);
  }

  const history = (historyRows ?? []).map((r: { role: string; content: string }) => ({
    role: r.role as "user" | "assistant",
    content: r.content,
  }));

  // 3. Auto-rename fire-and-forget if this is the first message
  const { data: convRow } = await supabase
    .from("conversations")
    .select("title")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .single();
  const isFirstMessage = history.length === 1 && !convRow?.title;
  if (isFirstMessage) {
    void autoRenameThread(conversationId, content, userId);
  }

  // 4. Build tools + system prompt and run the tool loop
  const tools = getToolsForMode(mode);
  const systemPrompt = await buildCloudChatSystemPrompt(mode, userId);
  const llmResponse = await runChatToolLoop({
    userId,
    model: model ?? DEFAULT_CHAT_MODEL,
    systemPrompt,
    history,
    tools,
  });

  // 5. Insert assistant message (with tool_calls + tool_results persisted)
  const assistantMsgId = crypto.randomUUID();
  const assistantAt = new Date().toISOString();
  const { data: assistantMsg, error: assistantInsertErr } = await supabase
    .from("messages")
    .insert({
      id: assistantMsgId,
      user_id: userId,
      conversation_id: conversationId,
      role: "assistant",
      content: llmResponse.text,
      tool_calls: llmResponse.toolCalls.length > 0 ? llmResponse.toolCalls : null,
      tool_results: llmResponse.toolResults.length > 0 ? llmResponse.toolResults : null,
      pending_actions: null,
      created_at: assistantAt,
    })
    .select()
    .single<MessageRow>();

  if (assistantInsertErr) {
    throw new Error(`[chat-handler] Failed to insert assistant message: ${assistantInsertErr.message}`);
  }

  // 6. Update conversation timestamp
  await supabase
    .from("conversations")
    .update({ updated_at: assistantAt })
    .eq("id", conversationId);

  // 7. Broadcast both messages on the user's event channel
  const channel = supabase.channel(`user:${userId}:events`);

  const broadcastUserMsg = {
    id: userMsg!.id,
    conversationId,
    role: "user",
    content,
    toolCalls: null,
    toolResults: null,
    pendingActions: null,
    createdAt: now,
  };

  const broadcastMsg = {
    id: assistantMsg!.id,
    conversationId,
    role: "assistant",
    content: llmResponse.text,
    toolCalls: llmResponse.toolCalls.length > 0 ? llmResponse.toolCalls : null,
    toolResults: llmResponse.toolResults.length > 0 ? llmResponse.toolResults : null,
    pendingActions: null,
    createdAt: assistantAt,
  };

  await Promise.all([
    channel.send({ type: "broadcast", event: "chat.messageCreated", payload: broadcastUserMsg }),
    channel.send({ type: "broadcast", event: "chat.messageCreated", payload: broadcastMsg }),
  ]).catch((err: Error) => {
    console.error("[chat-handler] Broadcast failed (non-fatal):", err.message);
  });

  supabase.removeChannel(channel);

  console.error(
    `[chat-handler] conversation ${conversationId} (${mode}): ` +
    `${llmResponse.inputTokens}in/${llmResponse.outputTokens}out tokens, ` +
    `${llmResponse.toolCalls.length} tool calls`,
  );

  // Demo metering — only after a fully successful LLM call. Failed or
  // errored runs don't consume a credit so visitors aren't penalised
  // for our infra problems.
  if (params.demoContext) {
    const costUsd = calculateRawCostUsd(
      model ?? DEFAULT_CHAT_MODEL,
      llmResponse.inputTokens,
      llmResponse.outputTokens,
    );
    await recordDemoMessage({
      sessionId: userId,
      ipHash: params.demoContext.ipHash,
      slug: params.demoContext.slug,
      costUsd,
    });
  }

  return { started: true };
}

/** No-op until streaming is implemented. */
export async function handleChatCancel(): Promise<{ cancelled: boolean }> {
  return { cancelled: true };
}

/**
 * Utility functions for the chat handler: LLM retries, history formatting,
 * message building, and tool result truncation.
 */

import { callLlmViaCli, type LlmCallConfig, type LlmCallResult } from "../planner/llm-via-cli.js";
import { renameConversation } from "../db/queries/conversations.js";
import { emit } from "../ipc/emitter.js";
import type { ChatMessage } from "@openhelm/shared";

export const MAX_TOOL_LOOP_ITERATIONS = 5;
export const MAX_HISTORY_MESSAGES = 20;
export const MAX_LLM_RETRIES = 2;
// Cap individual tool result payloads to prevent context overflow when job
// prompts or list results are large. Anything beyond this limit is truncated
// with a note so the LLM knows the data was clipped.
export const MAX_TOOL_RESULT_CHARS = 4000;

const PROMPT_TOO_LONG_PATTERNS = [
  "prompt is too long",
  "context_length_exceeded",
  "maximum context length",
  "input length and max_tokens exceed",
];

export function isPromptTooLongError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return PROMPT_TOO_LONG_PATTERNS.some((p) => lower.includes(p));
}

/** Fire-and-forget: rename a new thread based on the user's first message. */
export function autoRenameThread(convId: string, userContent: string, projectId: string | null): void {
  callLlmViaCli({
    model: "classification",
    systemPrompt: "You generate short, descriptive chat thread titles. Respond with ONLY the title text (2-5 words). No quotes, no explanation.",
    userMessage: `Generate a short title for a chat thread that starts with this message:\n\n${userContent.slice(0, 300)}`,
    disableTools: true,
    preferRawText: true,
  }).then((result) => {
    const title = result.text.trim().replace(/^["']|["']$/g, "").slice(0, 60);
    if (title) {
      const updated = renameConversation(convId, title);
      emit("chat.threadRenamed", { conversationId: convId, title: updated.title, projectId });
    }
  }).catch(() => { /* non-blocking — silently ignore all failures including DB errors */ });
}

/** Retry callLlmViaCli on transient failures (exit code 1, network errors). */
export async function callLlmWithRetry(config: LlmCallConfig): Promise<LlmCallResult> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
    try {
      return await callLlmViaCli(config);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      // Only retry on code-1 exits (transient network/rate-limit errors from the CLI).
      // Timeouts are NOT retried: our own timer killed the process because the request
      // was too slow. Retrying would just run three consecutive 10-minute attempts
      // before finally giving up — total wall time ~30 min vs the ~10 min fail-fast.
      const isTransient = lastErr.message.includes("exited with code 1");
      if (!isTransient || attempt === MAX_LLM_RETRIES) throw lastErr;
      const delay = 2000 * (attempt + 1);
      console.error(`[chat] LLM call failed (attempt ${attempt + 1}/${MAX_LLM_RETRIES + 1}), retrying in ${delay}ms: ${lastErr.message}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/** Truncate a serialized tool result to prevent context overflow. */
export function truncateToolResult(raw: string): string {
  if (raw.length <= MAX_TOOL_RESULT_CHARS) return raw;
  return raw.slice(0, MAX_TOOL_RESULT_CHARS) + `\n… [truncated ${raw.length - MAX_TOOL_RESULT_CHARS} chars]`;
}

/** Format DB message history into a conversation string for the LLM. */
export function formatHistoryForLlm(history: ChatMessage[]): string {
  return history.map((m) => {
    const role = m.role === "user" ? "User" : "Assistant";
    let text = `${role}: ${m.content}`;
    if (m.toolResults && m.toolResults.length > 0) {
      const results = m.toolResults.map((r) => {
        const payload = r.error ? `Error: ${r.error}` : JSON.stringify(r.result, null, 2);
        return `[Tool: ${r.tool}]\n${truncateToolResult(payload)}`;
      }).join("\n");
      text += `\n\n[Tool results]\n${results}`;
    }
    return text;
  }).join("\n\n");
}

/** Build the full LLM user message from history + current exchange. */
export function buildLlmUserMessage(
  history: ChatMessage[],
  userContent: string,
  toolExchange?: string,
): string {
  const parts: string[] = [];
  if (history.length > 0) {
    parts.push(formatHistoryForLlm(history));
    parts.push("---");
  }
  parts.push(`User: ${userContent}`);
  if (toolExchange) parts.push(toolExchange);
  return parts.join("\n\n");
}

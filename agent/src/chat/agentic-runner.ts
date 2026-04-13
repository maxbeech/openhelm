/**
 * Full-access chat runner: routes a chat message through the same agentic
 * backend path as a scheduled job (backend.run()), so the chat has parity with
 * job execution — full MCP tool access, browser MCP, E2B sandbox in cloud mode.
 *
 * Used by handleChatMessage() when permissionMode === "bypassPermissions".
 * The read-only path (permissionMode === "plan") still uses the XML tool-call
 * loop via callLlmViaCli; this runner bypasses that loop entirely.
 *
 * Limitation (v1): single-turn per message — prior chat history is prepended
 * into the prompt text. Multi-turn session resume for Goose/Claude-Code will
 * come later.
 */

import { randomUUID } from "crypto";
import { getProject } from "../db/queries/projects.js";
import { createMessage, listMessagesForConversation } from "../db/queries/conversations.js";
import { getBackend } from "../agent-backend/registry.js";
import { buildRunMcpContext } from "../mcp-servers/build-run-mcp-context.js";
import { emit } from "../ipc/emitter.js";
import type { ChatMessage } from "@openhelm/shared";
import type { AgentEvent as BackendAgentEvent } from "../agent-backend/types.js";

const MAX_HISTORY_MESSAGES = 20;
const FULL_ACCESS_TIMEOUT_MS = 15 * 60_000; // 15 minutes per message

export interface RunChatAgenticParams {
  projectId: string | null;
  content: string;
  conversationId: string;
  userMsg: ChatMessage;
  modelOverride?: string;
  effort?: "low" | "medium" | "high";
  abortSignal?: AbortSignal;
}

/** Format prior messages into a plain-text conversation prefix. */
function formatHistory(history: ChatMessage[]): string {
  return history.map((m) => {
    const role = m.role === "user" ? "User" : "Assistant";
    return `${role}: ${m.content}`;
  }).join("\n\n");
}

/**
 * Run the chat message as a full agentic backend run. Streams assistant text
 * back to the UI via chat.streaming events, mirroring the handler's regular path.
 * Returns the user message and the final assistant message.
 */
export async function runChatAgentic(params: RunChatAgenticParams): Promise<ChatMessage[]> {
  const { projectId, content, conversationId, userMsg, modelOverride, effort, abortSignal } = params;

  if (!projectId) {
    throw new Error("Full-access chat requires an active project (cannot run from 'All Projects').");
  }
  const project = getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  // Build MCP context (browser + data tables MCPs). Uses the same helper the
  // executor uses, so chat has full parity with scheduled job tooling.
  const runId = `chat-${randomUUID()}`;
  const mcpContext = await buildRunMcpContext({
    runId,
    projectId,
    browserCredentialsFilePath: undefined,
  });

  // Assemble the prompt: prior history + current user message, with MCP preambles prepended.
  const history = listMessagesForConversation(conversationId, MAX_HISTORY_MESSAGES);
  const historyPrefix = history.length > 0 ? `${formatHistory(history)}\n\n---\n\n` : "";
  const userPrompt = `${historyPrefix}User: ${content}`;
  const fullPrompt = mcpContext.promptPrefix + userPrompt;

  emit("chat.status", { status: "thinking", projectId, conversationId });

  // Stream assistant text back to the UI as it arrives. backend.run() emits
  // assistant events via onEvent; we reuse the chat.streaming fullText pattern.
  let fullStreamedText = "";
  const onEvent = (event: BackendAgentEvent) => {
    if (event.type === "assistant" && event.text) {
      fullStreamedText += event.text;
      emit("chat.streaming", { fullText: fullStreamedText, projectId, conversationId });
    } else if (event.type === "tool_use" && event.toolName) {
      emit("chat.status", {
        status: "reading",
        tools: [event.toolName],
        projectId,
        conversationId,
      });
    }
  };

  try {
    const backend = getBackend();
    await backend.run({
      workingDirectory: project.directoryPath,
      prompt: fullPrompt,
      model: modelOverride,
      effort: effort ?? "medium",
      permissionMode: "bypassPermissions",
      mcpConfigPath: mcpContext.mcpConfigPath,
      appendSystemPrompt: mcpContext.appendSystemPrompt,
      timeoutMs: FULL_ACCESS_TIMEOUT_MS,
      abortSignal,
      onEvent,
      // onStdout/onStderr intentionally omitted — assistant text is streamed
      // via onEvent (type: "assistant") which is normalized across backends.
    });
  } finally {
    // Clean up the per-run MCP config file
    if (mcpContext.mcpConfigPath) {
      try {
        const { removeMcpConfigFile } = await import("../mcp-servers/mcp-config-builder.js");
        removeMcpConfigFile(mcpContext.mcpConfigPath);
      } catch { /* ignore */ }
    }
  }

  emit("chat.status", { status: "done", projectId, conversationId });

  const finalText = fullStreamedText.trim() || "(No response from agent.)";
  const assistantMsg = createMessage({
    conversationId,
    role: "assistant",
    content: finalText,
  });
  emit("chat.messageCreated", { ...assistantMsg, projectId, conversationId });

  return [userMsg, assistantMsg];
}

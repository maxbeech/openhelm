/**
 * Core chat handler — orchestrates the LLM tool loop for the AI chat sidebar.
 * Handles message storage, read-tool auto-execution, and pending write-action collection.
 */

import { callLlmViaCli } from "../planner/llm-via-cli.js";
import { getProject } from "../db/queries/projects.js";
import { getGoal } from "../db/queries/goals.js";
import { getJob } from "../db/queries/jobs.js";
import { getRun } from "../db/queries/runs.js";
import {
  getOrCreateConversation,
  createMessage,
  getMessage,
  updateMessagePendingActions,
  listMessagesForProject,
} from "../db/queries/conversations.js";
import { buildChatSystemPrompt } from "./system-prompt.js";
import { parseLlmResponse, buildTextResponse } from "./response-parser.js";
import { isWriteTool, describeAction } from "./tools.js";
import { executeReadTool, executeWriteTool } from "./tool-executor.js";
import { emit } from "../ipc/emitter.js";
import type {
  ChatMessage, ChatContext, ChatToolCall, ChatToolResult, PendingAction,
} from "@openorchestra/shared";

const MAX_TOOL_LOOP_ITERATIONS = 5;
const MAX_HISTORY_MESSAGES = 20;

/** Format DB message history into a conversation string for the LLM. */
function formatHistoryForLlm(history: ChatMessage[]): string {
  return history.map((m) => {
    const role = m.role === "user" ? "User" : "Assistant";
    let text = `${role}: ${m.content}`;
    if (m.toolResults && m.toolResults.length > 0) {
      const results = m.toolResults.map((r) =>
        `[Tool: ${r.tool}]\n${r.error ? `Error: ${r.error}` : JSON.stringify(r.result, null, 2)}`
      ).join("\n");
      text += `\n\n[Tool results]\n${results}`;
    }
    return text;
  }).join("\n\n");
}

/** Build the full LLM user message from history + current exchange. */
function buildLlmUserMessage(
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

export async function handleChatMessage(
  projectId: string,
  content: string,
  context?: ChatContext,
): Promise<ChatMessage[]> {
  const project = getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  // Resolve context entities for the system prompt
  const viewingGoal = context?.viewingGoalId ? getGoal(context.viewingGoalId) : null;
  const viewingJob = context?.viewingJobId ? getJob(context.viewingJobId) : null;
  const viewingRun = context?.viewingRunId ? getRun(context.viewingRunId) : null;

  const conv = getOrCreateConversation(projectId);
  const history = listMessagesForProject(projectId, MAX_HISTORY_MESSAGES);

  // Store user message
  const userMsg = createMessage({ conversationId: conv.id, role: "user", content });
  emit("chat.messageCreated", userMsg);

  const systemPrompt = buildChatSystemPrompt({ project, viewingGoal, viewingJob, viewingRun });

  // Tool loop
  const allToolCalls: ChatToolCall[] = [];
  const allToolResults: ChatToolResult[] = [];
  const pendingActions: PendingAction[] = [];
  let toolExchange = "";
  let finalTextSegments: string[] = [];

  for (let iter = 0; iter < MAX_TOOL_LOOP_ITERATIONS; iter++) {
    emit("chat.status", { status: iter === 0 ? "thinking" : "analyzing" });
    const userMessage = buildLlmUserMessage(history, content, toolExchange || undefined);
    const rawResponse = await callLlmViaCli({ model: "chat", systemPrompt, userMessage });
    const parsed = parseLlmResponse(rawResponse);
    finalTextSegments = parsed.textSegments;

    if (!parsed.hasToolCalls) break;

    // Separate read vs write tool calls
    const readCalls = parsed.toolCalls.filter((c) => !isWriteTool(c.tool));
    const writeCalls = parsed.toolCalls.filter((c) => isWriteTool(c.tool));

    allToolCalls.push(...parsed.toolCalls);

    // Execute read tools immediately
    if (readCalls.length > 0) {
      emit("chat.status", { status: "reading", tools: readCalls.map((c) => c.tool) });
    }
    const readResults: ChatToolResult[] = readCalls.map((call) => {
      const result = executeReadTool(call, projectId);
      emit("chat.toolExecuted", { callId: call.id, tool: call.tool, result: result.result });
      return result;
    });
    allToolResults.push(...readResults);

    // Collect write tools as pending actions (already in allToolCalls from above)
    for (const call of writeCalls) {
      pendingActions.push({
        callId: call.id,
        tool: call.tool,
        args: call.args,
        description: describeAction(call.tool, call.args),
        status: "pending",
      });
    }

    if (writeCalls.length > 0) {
      // Can't continue loop if there are write tools pending confirmation
      finalTextSegments = parsed.textSegments;
      break;
    }

    // Build tool exchange for next iteration
    const resultsText = readResults.map((r) =>
      `<tool_result id="${r.callId}" tool="${r.tool}">\n${r.error ? `Error: ${r.error}` : JSON.stringify(r.result, null, 2)}\n</tool_result>`
    ).join("\n");
    toolExchange = [
      toolExchange,
      `Assistant: ${rawResponse}`,
      `\n[Tool results from above]\n${resultsText}`,
      `\nContinue your response based on the tool results above.`,
    ].filter(Boolean).join("\n\n");

    // If no write calls and no more tool calls, exit loop
    if (readResults.length === 0) break;
  }

  emit("chat.status", { status: "done" });
  const finalContent = buildTextResponse(finalTextSegments);

  // Store assistant message
  const assistantMsg = createMessage({
    conversationId: conv.id,
    role: "assistant",
    content: finalContent,
    toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
    toolResults: allToolResults.length > 0 ? allToolResults : undefined,
    pendingActions: pendingActions.length > 0 ? pendingActions : undefined,
  });

  emit("chat.messageCreated", assistantMsg);
  if (pendingActions.length > 0) {
    emit("chat.actionPending", { messageId: assistantMsg.id, actions: pendingActions });
  }

  return [userMsg, assistantMsg];
}

export async function handleActionApproval(
  messageId: string,
  callId: string,
  projectId: string,
): Promise<ChatMessage> {
  const msg = getMessage(messageId);
  if (!msg) throw new Error(`Message not found: ${messageId}`);

  const pending = msg.pendingActions ?? [];
  const action = pending.find((a) => a.callId === callId);
  if (!action) throw new Error(`Action not found: ${callId}`);
  if (action.status !== "pending") throw new Error(`Action already resolved: ${callId}`);

  // Execute the write tool
  const call: ChatToolCall = { id: callId, tool: action.tool, args: action.args };
  const result = executeWriteTool(call, projectId);

  // Mark approved
  let updated = pending.map((a) => a.callId === callId ? { ...a, status: "approved" as const } : a);

  // When a goal is created, link sibling create_job actions to the real goal ID.
  // The LLM may have used a placeholder goalId that doesn't exist in the DB.
  if (action.tool === "create_goal" && result.result && !result.error) {
    const createdGoalId = (result.result as { id: string }).id;
    updated = updated.map((a) => {
      if (a.tool === "create_job" && a.status === "pending" && a.args.goalId) {
        const existing = getGoal(a.args.goalId as string);
        if (!existing) {
          return { ...a, args: { ...a.args, goalId: createdGoalId } };
        }
      }
      return a;
    });
  }

  const updatedMsg = updateMessagePendingActions(messageId, updated);

  emit("chat.actionResolved", { messageId, callId, status: "approved" });
  return updatedMsg;
}

export function handleActionRejection(messageId: string, callId: string): ChatMessage {
  const msg = getMessage(messageId);
  if (!msg) throw new Error(`Message not found: ${messageId}`);

  const pending = msg.pendingActions ?? [];
  const action = pending.find((a) => a.callId === callId);
  if (!action) throw new Error(`Action not found: ${callId}`);

  const updated = pending.map((a) => a.callId === callId ? { ...a, status: "rejected" as const } : a);
  const updatedMsg = updateMessagePendingActions(messageId, updated);

  emit("chat.actionResolved", { messageId, callId, status: "rejected" });
  return updatedMsg;
}

/**
 * Approve all pending actions on a message in order.
 * Goal actions are processed first so FK linking works for sibling jobs.
 */
export async function handleApproveAll(
  messageId: string,
  projectId: string,
): Promise<ChatMessage> {
  const msg = getMessage(messageId);
  if (!msg) throw new Error(`Message not found: ${messageId}`);

  const pending = msg.pendingActions ?? [];
  const pendingCallIds = pending
    .filter((a) => a.status === "pending")
    .map((a) => a.callId);

  if (pendingCallIds.length === 0) throw new Error("No pending actions to approve");

  // Process sequentially — goal before jobs for FK linking
  let current: ChatMessage = msg;
  for (const callId of pendingCallIds) {
    current = await handleActionApproval(messageId, callId, projectId);
  }

  return current;
}

/**
 * Reject all pending actions on a message at once.
 */
export function handleRejectAll(messageId: string): ChatMessage {
  const msg = getMessage(messageId);
  if (!msg) throw new Error(`Message not found: ${messageId}`);

  const pending = msg.pendingActions ?? [];
  const pendingActions = pending.filter((a) => a.status === "pending");
  if (pendingActions.length === 0) throw new Error("No pending actions to reject");

  const updated = pending.map((a) =>
    a.status === "pending" ? { ...a, status: "rejected" as const } : a,
  );
  const updatedMsg = updateMessagePendingActions(messageId, updated);

  for (const a of pendingActions) {
    emit("chat.actionResolved", { messageId, callId: a.callId, status: "rejected" });
  }

  return updatedMsg;
}

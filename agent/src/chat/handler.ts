/**
 * Core chat handler — orchestrates the LLM tool loop for the AI chat sidebar.
 * Handles message storage, read-tool auto-execution, and pending write-action collection.
 */

import { callLlmViaCli, type LlmCallConfig, type LlmCallResult } from "../planner/llm-via-cli.js";
import { getProject } from "../db/queries/projects.js";
import { getGoal } from "../db/queries/goals.js";
import { getJob } from "../db/queries/jobs.js";
import { getRun } from "../db/queries/runs.js";
import {
  getOrCreateConversation,
  createMessage,
  listMessagesForConversation,
} from "../db/queries/conversations.js";
import { buildChatSystemPromptAsync, buildAllProjectsSystemPromptAsync } from "./system-prompt.js";
import { parseLlmResponse, buildTextResponse } from "./response-parser.js";
import { isWriteTool, describeAction } from "./tools.js";
import { executeReadTool } from "./tool-executor.js";
import { emit } from "../ipc/emitter.js";
import type {
  ChatMessage, ChatContext, ChatToolCall, ChatToolResult, PendingAction,
} from "@openhelm/shared";

const MAX_TOOL_LOOP_ITERATIONS = 5;
const MAX_HISTORY_MESSAGES = 20;
const MAX_LLM_RETRIES = 2;

/** Retry callLlmViaCli on transient failures (exit code 1, network errors). */
async function callLlmWithRetry(config: LlmCallConfig): Promise<LlmCallResult> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
    try {
      return await callLlmViaCli(config);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      const isTransient = lastErr.message.includes("exited with code 1")
        || lastErr.message.includes("timed out");
      if (!isTransient || attempt === MAX_LLM_RETRIES) throw lastErr;
      const delay = 2000 * (attempt + 1);
      console.error(`[chat] LLM call failed (attempt ${attempt + 1}/${MAX_LLM_RETRIES + 1}), retrying in ${delay}ms: ${lastErr.message}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

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
  projectId: string | null,
  content: string,
  context?: ChatContext,
  modelOverride?: string,
  effort?: "low" | "medium" | "high",
  permissionMode?: string,
  conversationId?: string,
): Promise<ChatMessage[]> {
  // Resolve project — null means "All Projects" thread
  const project = projectId ? getProject(projectId) : null;
  if (projectId && !project) throw new Error(`Project not found: ${projectId}`);

  // Resolve context entities for the system prompt (only when scoped to a project)
  let viewingGoal = context?.viewingGoalId ? getGoal(context.viewingGoalId) : null;
  let viewingJob = context?.viewingJobId ? getJob(context.viewingJobId) : null;
  let viewingRun = context?.viewingRunId ? getRun(context.viewingRunId) : null;

  // Discard context entities that don't belong to this project (stale cross-project refs)
  if (project) {
    if (viewingGoal && viewingGoal.projectId !== projectId) viewingGoal = null;
    if (viewingJob && viewingJob.projectId !== projectId) viewingJob = null;
    if (viewingRun) {
      const runJob = getJob(viewingRun.jobId);
      if (!runJob || runJob.projectId !== projectId) viewingRun = null;
    }
  }

  // Start async system prompt build early so it overlaps with sync DB work below
  const systemPromptPromise = project
    ? buildChatSystemPromptAsync({ project, viewingGoal, viewingJob, viewingRun })
    : buildAllProjectsSystemPromptAsync();

  const conv = getOrCreateConversation(projectId, conversationId);
  const convId = conv.id;
  const history = listMessagesForConversation(convId, MAX_HISTORY_MESSAGES);

  // Store user message
  const userMsg = createMessage({ conversationId: convId, role: "user", content });
  emit("chat.messageCreated", { ...userMsg, projectId, conversationId: convId });

  // Emit early "thinking" so the UI shows feedback during async prompt build
  emit("chat.status", { status: "thinking", projectId, conversationId: convId });

  const systemPrompt = await systemPromptPromise;

  // Tool loop
  const allToolCalls: ChatToolCall[] = [];
  const allToolResults: ChatToolResult[] = [];
  const pendingActions: PendingAction[] = [];
  let toolExchange = "";
  let finalTextSegments: string[] = [];

  // Stateful streaming sanitizer — buffers text while inside a <tool_call> block
  // so that blocks spanning multiple chunks never leak to the UI.
  let streamBuffer = "";
  let insideToolCall = false;

  function sanitizeStreamChunk(text: string): string {
    let output = "";
    streamBuffer += text;
    while (streamBuffer.length > 0) {
      if (insideToolCall) {
        const closeIdx = streamBuffer.indexOf("</tool_call>");
        if (closeIdx === -1) { break; }
        streamBuffer = streamBuffer.slice(closeIdx + "</tool_call>".length);
        insideToolCall = false;
      } else {
        const openIdx = streamBuffer.indexOf("<tool_call>");
        if (openIdx === -1) { output += streamBuffer; streamBuffer = ""; break; }
        output += streamBuffer.slice(0, openIdx);
        streamBuffer = streamBuffer.slice(openIdx + "<tool_call>".length);
        insideToolCall = true;
      }
    }
    return output.trimEnd();
  }

  // Session ID captured from first CLI call, reused in subsequent tool loop iterations
  // to avoid CLI cold-start overhead.
  let sessionId: string | null = null;

  for (let iter = 0; iter < MAX_TOOL_LOOP_ITERATIONS; iter++) {
    emit("chat.status", { status: iter === 0 ? "thinking" : "analyzing", projectId, conversationId: convId });
    // Reset stream buffer state for each LLM iteration
    streamBuffer = "";
    insideToolCall = false;
    const userMessage = buildLlmUserMessage(history, content, toolExchange || undefined);
    const llmResult = await callLlmWithRetry({
      model: "chat",
      modelOverride,
      effort,
      systemPrompt,
      userMessage,
      disableTools: false,
      workingDirectory: project?.directoryPath,
      permissionMode: permissionMode || "plan",
      preferRawText: true,
      resumeSessionId: sessionId ?? undefined,
      onTextChunk: (text) => {
        const stripped = sanitizeStreamChunk(text);
        if (stripped) emit("chat.streaming", { text: stripped, projectId, conversationId: convId });
      },
      onToolUse: (toolName) => {
        emit("chat.status", { status: "reading", tools: [toolName], projectId, conversationId: convId });
      },
    });
    const rawResponse = llmResult.text;
    if (!sessionId && llmResult.sessionId) sessionId = llmResult.sessionId;
    const parsed = parseLlmResponse(rawResponse);
    finalTextSegments = parsed.textSegments;

    if (!parsed.hasToolCalls) break;

    // Separate read vs write tool calls
    const readCalls = parsed.toolCalls.filter((c) => !isWriteTool(c.tool));
    const writeCalls = parsed.toolCalls.filter((c) => isWriteTool(c.tool));

    allToolCalls.push(...parsed.toolCalls);

    // Execute read tools immediately (status already emitted via onToolUse for native tools;
    // this covers app-level XML tool calls)
    if (readCalls.length > 0) {
      emit("chat.status", { status: "reading", tools: readCalls.map((c) => c.tool), projectId, conversationId: convId });
    }
    const readResults: ChatToolResult[] = readCalls.map((call) => {
      const result = executeReadTool(call, projectId);
      emit("chat.toolExecuted", { callId: call.id, tool: call.tool, result: result.result, projectId, conversationId: convId });
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

  emit("chat.status", { status: "done", projectId, conversationId: convId });
  const finalContent = buildTextResponse(finalTextSegments);

  // Fallback: if the LLM produced no text (only tool calls), provide a contextual summary
  let displayContent = finalContent;
  if (!displayContent) {
    if (pendingActions.length > 0) {
      displayContent = "Based on your request, here's what I'd suggest:";
    } else if (allToolCalls.length > 0) {
      displayContent = "I looked into this for you.";
    }
  }

  // Store assistant message
  const assistantMsg = createMessage({
    conversationId: convId,
    role: "assistant",
    content: displayContent,
    toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
    toolResults: allToolResults.length > 0 ? allToolResults : undefined,
    pendingActions: pendingActions.length > 0 ? pendingActions : undefined,
  });

  emit("chat.messageCreated", { ...assistantMsg, projectId, conversationId: convId });
  if (pendingActions.length > 0) {
    emit("chat.actionPending", { messageId: assistantMsg.id, actions: pendingActions, projectId, conversationId: convId });
  }

  return [userMsg, assistantMsg];
}


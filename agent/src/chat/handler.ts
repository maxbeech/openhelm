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
  renameConversation,
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

/** Fire-and-forget: rename a new thread based on the user's first message. */
function autoRenameThread(convId: string, userContent: string, projectId: string | null): void {
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
  }).catch(() => { /* non-blocking — silently ignore failures */ });
}

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
  abortSignal?: AbortSignal,
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

  // Auto-rename thread on first user message (non-blocking)
  if (history.length === 0 && !conv.title) {
    autoRenameThread(convId, content, projectId);
  }

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
        // Insert space so text around stripped tool_call blocks doesn't run together
        if (streamBuffer.length > 0) output += " ";
      } else {
        const openIdx = streamBuffer.indexOf("<tool_call>");
        if (openIdx === -1) { output += streamBuffer; streamBuffer = ""; break; }
        output += streamBuffer.slice(0, openIdx);
        streamBuffer = streamBuffer.slice(openIdx + "<tool_call>".length);
        insideToolCall = true;
      }
    }
    return output;
  }

  // Session ID captured from first CLI call, reused in subsequent tool loop iterations
  // to avoid CLI cold-start overhead.
  let sessionId: string | null = null;
  // Track total emitted streaming text to deduplicate — the CLI may emit
  // cumulative assistant events rather than pure deltas.
  let totalStreamedText = "";

  for (let iter = 0; iter < MAX_TOOL_LOOP_ITERATIONS; iter++) {
    emit("chat.status", { status: iter === 0 ? "thinking" : "analyzing", projectId, conversationId: convId });
    // Emit a separator between tool-loop iterations so streaming text doesn't run together
    if (iter > 0) {
      emit("chat.streaming", { text: "\n\n", projectId, conversationId: convId });
    }
    // Reset stream buffer state for each LLM iteration
    streamBuffer = "";
    insideToolCall = false;
    totalStreamedText = "";
    const userMessage = buildLlmUserMessage(history, content, toolExchange || undefined);
    if (abortSignal?.aborted) throw new Error("Chat cancelled by user");

    const llmResult = await callLlmWithRetry({
      model: "chat",
      modelOverride,
      effort,
      systemPrompt,
      userMessage,
      // Allow only safe read/search tools; block Bash and Agent so the LLM
      // is forced to use XML tool_call blocks for OpenHelm data queries.
      allowedTools: "WebSearch,WebFetch,Read,Glob,Grep",
      disallowedTools: "Bash,Agent",
      workingDirectory: project?.directoryPath,
      permissionMode: permissionMode || "plan",
      preferRawText: true,
      resumeSessionId: sessionId ?? undefined,
      abortSignal,
      onTextChunk: (text) => {
        const stripped = sanitizeStreamChunk(text);
        if (!stripped) return;
        // Deduplicate: if the CLI sends cumulative text, extract only the new portion.
        // Three cases:
        //   1. Cumulative: new chunk is a superset of what we've already sent
        //   2. Subset/equal: already emitted all of this — skip
        //   3. Pure delta: normal incremental chunk, emit as-is
        if (stripped.length > totalStreamedText.length && stripped.startsWith(totalStreamedText)) {
          // Case 1: cumulative mode
          const delta = stripped.slice(totalStreamedText.length);
          totalStreamedText = stripped;
          emit("chat.streaming", { text: delta, projectId, conversationId: convId });
        } else if (totalStreamedText.startsWith(stripped)) {
          // Case 2: subset or duplicate — skip (also handles empty totalStreamedText when stripped is "")
        } else {
          // Case 3: pure delta
          totalStreamedText += stripped;
          emit("chat.streaming", { text: stripped, projectId, conversationId: convId });
        }
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

  // Fallback: detect when LLM described creation without tool_call blocks
  if (pendingActions.length === 0 && allToolCalls.length === 0) {
    const candidateText = buildTextResponse(finalTextSegments);
    if (candidateText.length > 50) {
      console.error(`[chat] response with no tool calls (${candidateText.length} chars). First 200: ${candidateText.slice(0, 200)}`);
    }
    const describesCreation = /\b(creat|set up|add|configur|defin)\w*\b.{0,50}\b(goal|job|target|visualization|data table|chart|memory)\b/i.test(candidateText);
    if (describesCreation && !abortSignal?.aborted) {
      console.error("[chat] LLM described creation without tool_call blocks — sending nudge");
      try {
        const nudgeMessage = buildLlmUserMessage(history, content,
          `Assistant: ${candidateText}\n\nUser: Please produce the actual <tool_call> XML blocks for the actions you described above. Output only the tool calls, no explanation.`
        );
        const nudgeResult = await callLlmWithRetry({
          model: "chat", modelOverride, effort, systemPrompt,
          userMessage: nudgeMessage,
          allowedTools: "WebSearch,WebFetch,Read,Glob,Grep",
          disallowedTools: "Bash,Agent",
          workingDirectory: project?.directoryPath,
          permissionMode: permissionMode || "plan",
          preferRawText: true,
          resumeSessionId: sessionId ?? undefined,
          abortSignal,
        });
        const nudgeParsed = parseLlmResponse(nudgeResult.text);
        if (nudgeParsed.hasToolCalls) {
          const writeCalls = nudgeParsed.toolCalls.filter((c) => isWriteTool(c.tool));
          allToolCalls.push(...nudgeParsed.toolCalls);
          for (const call of writeCalls) {
            pendingActions.push({
              callId: call.id, tool: call.tool, args: call.args,
              description: describeAction(call.tool, call.args), status: "pending",
            });
          }
          if (nudgeParsed.textSegments.length > 0) finalTextSegments = nudgeParsed.textSegments;
        }
      } catch (err) {
        console.error("[chat] nudge follow-up failed:", err);
      }
    }
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


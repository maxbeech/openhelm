/**
 * Multi-turn tool loop using OpenAI native function calling.
 *
 * Runs up to MAX_ITERATIONS of [LLM call → execute any tool_calls → feed
 * results back]. Terminates when the model emits a plain content reply
 * with no tool_calls, or when the iteration cap is hit (in which case we
 * force a final tool-free call to extract a summary).
 */

import OpenAI from "openai";
import { getOpenRouterClient, resolveModel } from "../llm-router.js";
import { meterUsage } from "../usage-meter.js";
import { executeToolCall } from "./tool-executor.js";

const MAX_ITERATIONS = 5;
const DEFAULT_MAX_TOKENS = 4096;

export interface ChatToolCallRecord {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface ChatToolResultRecord {
  callId: string;
  tool: string;
  result?: unknown;
  error?: string;
}

export interface ToolLoopRequest {
  userId: string;
  model?: string;
  systemPrompt: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
  maxTokens?: number;
}

export interface ToolLoopResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: ChatToolCallRecord[];
  toolResults: ChatToolResultRecord[];
}

type ChatMsg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export async function runChatToolLoop(req: ToolLoopRequest): Promise<ToolLoopResponse> {
  const client = getOpenRouterClient();
  const modelId = resolveModel(req.model);
  const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;

  const messages: ChatMsg[] = [
    { role: "system", content: req.systemPrompt },
    ...req.history.map((m) => ({ role: m.role, content: m.content } as ChatMsg)),
  ];

  const toolCalls: ChatToolCallRecord[] = [];
  const toolResults: ChatToolResultRecord[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let finalText = "";

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const response = await client.chat.completions.create({
      model: modelId,
      max_tokens: maxTokens,
      messages,
      tools: req.tools,
      tool_choice: "auto",
    });

    inputTokens += response.usage?.prompt_tokens ?? 0;
    outputTokens += response.usage?.completion_tokens ?? 0;

    const assistantMsg = response.choices[0]?.message;
    if (!assistantMsg) {
      finalText = "";
      break;
    }

    const requestedCalls = assistantMsg.tool_calls ?? [];
    if (requestedCalls.length === 0) {
      // Natural stop — LLM produced a plain text reply
      finalText = assistantMsg.content ?? "";
      break;
    }

    // Push the assistant turn (with its tool_calls) so follow-up tool messages
    // have a parent to attach to per the OpenAI message schema.
    messages.push({
      role: "assistant",
      content: assistantMsg.content ?? "",
      tool_calls: requestedCalls,
    });

    for (const call of requestedCalls) {
      if (call.type !== "function") continue;
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }

      const result = await executeToolCall(name, args, req.userId);
      const resultStr = safeStringify(result);

      toolCalls.push({ id: call.id, tool: name, args });
      const hasError = typeof result === "object" && result !== null && "error" in (result as object);
      toolResults.push({
        callId: call.id,
        tool: name,
        ...(hasError ? { error: String((result as { error: unknown }).error) } : { result }),
      });

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: resultStr,
      } as ChatMsg);
    }
    // Loop again — LLM gets the tool results and decides what to do next
  }

  if (!finalText) {
    // Iteration cap reached without natural termination. Force one tool-free
    // call to get a coherent summary from whatever context we accumulated.
    const final = await client.chat.completions.create({
      model: modelId,
      max_tokens: maxTokens,
      messages,
      tool_choice: "none",
    });
    inputTokens += final.usage?.prompt_tokens ?? 0;
    outputTokens += final.usage?.completion_tokens ?? 0;
    finalText = final.choices[0]?.message?.content ?? "";
  }

  await meterUsage({
    userId: req.userId,
    callType: "chat",
    model: modelId,
    inputTokens,
    outputTokens,
  });

  return { text: finalText, inputTokens, outputTokens, toolCalls, toolResults };
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

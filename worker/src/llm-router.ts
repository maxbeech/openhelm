/**
 * LLM Router — OpenRouter API calls for lightweight operations.
 *
 * Uses the OpenAI-compatible SDK with OpenRouter's base URL so all
 * OpenAI (and other) models are available via a single API key.
 *
 * Used for: chat, planning, summarisation, assessment.
 * These operations don't need file system access so they skip the E2B sandbox,
 * keeping costs low and latency under 2 seconds.
 */

import OpenAI from "openai";
import { config } from "./config.js";
import { meterUsage, type CallType } from "./usage-meter.js";

export interface LlmRequest {
  userId: string;
  callType: CallType;
  userMessage: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  runId?: string;
  onChunk?: (text: string) => void;
}

export interface LlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ChatCallRequest {
  userId: string;
  /** Full conversation history in chronological order (latest last). */
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
}

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: config.openrouterApiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://openhelm.ai",
        "X-Title": "OpenHelm",
      },
    });
  }
  return _client;
}

/** Public accessor so chat/tool-loop.ts can make raw tool-calling requests. */
export function getOpenRouterClient(): OpenAI {
  return getClient();
}

/** Map tier names to OpenRouter model IDs (OpenAI models) */
export function resolveModel(model?: string): string {
  const map: Record<string, string> = {
    haiku: "openai/gpt-4o-mini",
    sonnet: "openai/gpt-4o",
    opus: "openai/gpt-4o",
    // Pass-through for fully-qualified OpenRouter IDs (e.g. "openai/gpt-4o-mini")
  };
  return map[model ?? "haiku"] ?? model ?? "openai/gpt-4o-mini";
}

/** Single-turn LLM call with usage metering. Supports streaming via onChunk. */
export async function llmCall(req: LlmRequest): Promise<LlmResponse> {
  const client = getClient();
  const modelId = resolveModel(req.model);
  const maxTokens = req.maxTokens ?? 4096;

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "user", content: req.userMessage },
  ];

  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;

  if (req.onChunk) {
    // Streaming mode
    const stream = await client.chat.completions.create({
      model: modelId,
      max_tokens: maxTokens,
      ...(req.systemPrompt ? { messages: [{ role: "system" as const, content: req.systemPrompt }, ...messages] } : { messages }),
      stream: true,
      stream_options: { include_usage: true },
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        text += delta;
        req.onChunk(delta);
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }
    }
  } else {
    // Non-streaming mode
    const allMessages: OpenAI.ChatCompletionMessageParam[] = req.systemPrompt
      ? [{ role: "system", content: req.systemPrompt }, ...messages]
      : messages;

    const response = await client.chat.completions.create({
      model: modelId,
      max_tokens: maxTokens,
      messages: allMessages,
    });

    text = response.choices[0]?.message?.content ?? "";
    inputTokens = response.usage?.prompt_tokens ?? 0;
    outputTokens = response.usage?.completion_tokens ?? 0;
  }

  // Meter usage
  await meterUsage({
    userId: req.userId,
    runId: req.runId,
    callType: req.callType,
    model: modelId,
    inputTokens,
    outputTokens,
  });

  return { text, inputTokens, outputTokens };
}

/** Multi-turn chat call with full conversation history. */
export async function chatCall(req: ChatCallRequest): Promise<LlmResponse> {
  const client = getClient();
  const modelId = resolveModel(req.model);
  const maxTokens = req.maxTokens ?? 4096;

  const messages: OpenAI.ChatCompletionMessageParam[] = req.systemPrompt
    ? [{ role: "system", content: req.systemPrompt }, ...req.messages]
    : req.messages;

  const response = await client.chat.completions.create({
    model: modelId,
    max_tokens: maxTokens,
    messages,
  });

  const text = response.choices[0]?.message?.content ?? "";
  const inputTokens = response.usage?.prompt_tokens ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;

  await meterUsage({
    userId: req.userId,
    callType: "chat",
    model: modelId,
    inputTokens,
    outputTokens,
  });

  return { text, inputTokens, outputTokens };
}

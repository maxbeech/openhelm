import type { IpcRequest, IpcResponse, IpcError } from "@openorchestra/shared";
import { LlmError, type LlmErrorCode } from "../llm/client.js";

type HandlerFn = (params?: unknown) => unknown | Promise<unknown>;

const handlers = new Map<string, HandlerFn>();

/** Human-readable messages for LLM error codes */
const LLM_ERROR_MESSAGES: Record<LlmErrorCode, string> = {
  missing_api_key:
    "Anthropic API key not configured. Add it in Settings to use AI features.",
  authentication_failed:
    "Invalid Anthropic API key. Check your key in Settings.",
  rate_limited:
    "Anthropic API rate limit exceeded. Please try again in a moment.",
  overloaded:
    "The Anthropic API is temporarily overloaded. Please try again later.",
  network_error:
    "Couldn't reach the Anthropic API. Check your internet connection and try again.",
  timeout:
    "Request to the Anthropic API timed out. Check your connection and try again.",
  invalid_request: "Invalid request sent to the Anthropic API.",
  unknown: "An unexpected error occurred while communicating with the Anthropic API.",
};

/** Register an IPC method handler */
export function registerHandler(method: string, fn: HandlerFn) {
  handlers.set(method, fn);
}

/** Route an IPC request to the appropriate handler */
export async function handleRequest(req: IpcRequest): Promise<IpcResponse> {
  const handler = handlers.get(req.method);

  if (!handler) {
    const error: IpcError = {
      code: -32601,
      message: `Unknown method: ${req.method}`,
    };
    return { id: req.id, error };
  }

  try {
    const result = await handler(req.params);
    return { id: req.id, result };
  } catch (err) {
    if (err instanceof LlmError) {
      const error: IpcError = {
        code: -32001,
        message: LLM_ERROR_MESSAGES[err.code] ?? LLM_ERROR_MESSAGES.unknown,
      };
      return { id: req.id, error };
    }

    const error: IpcError = {
      code: -32603,
      message: err instanceof Error ? err.message : String(err),
    };
    return { id: req.id, error };
  }
}

// -- Built-in handlers --

const startTime = Date.now();

registerHandler("ping", () => ({
  message: "pong",
  timestamp: Date.now(),
}));

registerHandler("health", () => ({
  uptime: Math.floor((Date.now() - startTime) / 1000),
  memory: process.memoryUsage(),
}));

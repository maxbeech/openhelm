import type { IpcRequest, IpcResponse, IpcError } from "@openorchestra/shared";
import { PrintError } from "../claude-code/print.js";
import { captureAgentError } from "../sentry.js";

type HandlerFn = (params?: unknown) => unknown | Promise<unknown>;

const handlers = new Map<string, HandlerFn>();

/** Register an IPC method handler */
export function registerHandler(method: string, fn: HandlerFn) {
  handlers.set(method, fn);
}

// Methods too noisy to log on every call
const SILENT_METHODS = new Set(["ping", "health"]);

/** Route an IPC request to the appropriate handler */
export async function handleRequest(req: IpcRequest): Promise<IpcResponse> {
  const handler = handlers.get(req.method);
  const silent = SILENT_METHODS.has(req.method);

  if (!handler) {
    console.error(`[ipc] unknown method: ${req.method}`);
    const error: IpcError = {
      code: -32601,
      message: `Unknown method: ${req.method}`,
    };
    return { id: req.id, error };
  }

  if (!silent) console.error(`[ipc] → ${req.method}`);
  const t0 = Date.now();

  try {
    const result = await handler(req.params);
    if (!silent) console.error(`[ipc] ← ${req.method} (${Date.now() - t0}ms)`);
    return { id: req.id, result };
  } catch (err) {
    console.error(`[ipc] ✗ ${req.method} (${Date.now() - t0}ms):`, err instanceof Error ? err.message : err);
    if (err instanceof PrintError) {
      const error: IpcError = {
        code: -32001,
        message: err.message,
      };
      return { id: req.id, error };
    }

    // Unexpected handler error — capture in Sentry (no params, only method name)
    captureAgentError(err, { method: req.method });
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

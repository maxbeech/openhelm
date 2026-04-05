import type { IpcEvent } from "@openhelm/shared";
import { broadcastEvent } from "./dev-server.js";
import { onAgentEvent } from "./inbox-bridge.js";

/** Write a JSON message to stdout (IPC channel) and SSE clients */
export function send(msg: object) {
  const line = JSON.stringify(msg);
  try {
    process.stdout.write(line + "\n");
  } catch {
    // stdout pipe broken (Tauri read-end closed) — nothing we can do
  }
  broadcastEvent(line);
}

/** Emit an IPC event to the frontend */
export function emit(event: string, data: unknown = {}) {
  const evt: IpcEvent = { event, data };
  send(evt);
  // Feed the inbox bridge (sync, fire-and-forget)
  try { onAgentEvent(event, data); } catch { /* never block the emitter */ }
}

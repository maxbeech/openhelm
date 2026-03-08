import { createInterface } from "readline";
import type { IpcRequest, IpcEvent } from "@openorchestra/shared";
import { handleRequest } from "./ipc/handler.js";
import { registerAllHandlers } from "./ipc/handlers/index.js";
import { initDatabase } from "./db/init.js";

/** Write a JSON message to stdout (IPC channel) */
function send(msg: object) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

/** Emit an IPC event to the frontend */
function emit(event: string, data: unknown = {}) {
  const evt: IpcEvent = { event, data };
  send(evt);
}

// -- Bootstrap --

console.error("[agent] starting OpenOrchestra agent v0.1.0");

// 1. Initialize database
try {
  initDatabase();
} catch (err) {
  console.error("[agent] database init failed:", err);
  process.exit(1);
}

// 2. Register all IPC handlers
registerAllHandlers();

// 3. Start IPC listener on stdin
const rl = createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  let req: IpcRequest;

  try {
    req = JSON.parse(line);
  } catch {
    console.error("[agent] invalid JSON on stdin:", line);
    return;
  }

  if (!req.id || !req.method) {
    console.error("[agent] malformed request (missing id or method):", line);
    return;
  }

  const response = await handleRequest(req);
  send(response);
});

rl.on("close", () => {
  console.error("[agent] stdin closed, shutting down");
  process.exit(0);
});

// 4. Signal readiness
emit("agent.ready", { version: "0.1.0" });
console.error("[agent] ready, listening for IPC on stdin");

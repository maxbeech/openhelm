import { createInterface } from "readline";
import type { IpcRequest } from "@openorchestra/shared";
import { handleRequest } from "./ipc/handler.js";
import { registerAllHandlers } from "./ipc/handlers/index.js";
import { initDatabase } from "./db/init.js";
import { emit, send } from "./ipc/emitter.js";
import { detectClaudeCode } from "./claude-code/detector.js";
import { scheduler } from "./scheduler/index.js";
import { executor } from "./executor/index.js";

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

// 3. Crash recovery — must happen after DB init, before scheduler start
executor.recoverFromCrash();

// 4. Start IPC listener on stdin
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
  scheduler.stop();
  executor.stopAll();
  process.exit(0);
});

// 5. Signal readiness
emit("agent.ready", { version: "0.1.0" });
console.error("[agent] ready, listening for IPC on stdin");

// 6. Auto-detect Claude Code CLI in background (non-blocking)
detectClaudeCode()
  .then((result) => {
    if (result.found) {
      console.error(
        `[agent] Claude Code detected: ${result.path} (v${result.version})`,
      );
    } else {
      console.error(`[agent] Claude Code not found: ${result.error}`);
    }
    emit("claudeCode.detected", result);
  })
  .catch((err) => {
    console.error("[agent] Claude Code detection error:", err);
  });

// 7. Start scheduler — connects to executor via callback
scheduler.setOnWorkEnqueued(() => executor.processNext());
scheduler.start();

// Process any re-enqueued runs from crash recovery
executor.processNext();

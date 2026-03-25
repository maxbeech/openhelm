import { createInterface } from "readline";
import type { IpcRequest } from "@openhelm/shared";
import { handleRequest } from "./ipc/handler.js";
import { registerAllHandlers } from "./ipc/handlers/index.js";
import { initDatabase } from "./db/init.js";
import { deleteSetting } from "./db/queries/settings.js";
import { emit, send } from "./ipc/emitter.js";
import { startDevServer } from "./ipc/dev-server.js";
import { detectClaudeCode } from "./claude-code/detector.js";
import { scheduler } from "./scheduler/index.js";
import { executor } from "./executor/index.js";
import { getSetting } from "./db/queries/settings.js";
import { initAgentSentry, captureAgentError } from "./sentry.js";
import { initPowerManagement, shutdownPowerManagement } from "./power/index.js";
import { startPeriodicVerifier, stopPeriodicVerifier } from "./license/periodic-verifier.js";

// -- Bootstrap --

const t0 = Date.now();
const elapsed = () => `${Date.now() - t0}ms`;
console.error("[agent] starting OpenHelm agent v0.1.0");

// 1. Initialize database
try {
  initDatabase();
  console.error(`[agent] database ready (${elapsed()})`);
} catch (err) {
  console.error("[agent] database init failed:", err);
  process.exit(1);
}

// 1b. One-time cleanup: remove legacy API key if stored
try {
  deleteSetting("anthropic_api_key" as any);
} catch {
  // Ignore — key may not exist
}

// 1c. Initialize Sentry (non-fatal — reads analytics_enabled setting from DB)
try {
  initAgentSentry();
} catch (err) {
  console.error("[agent] sentry init failed (non-fatal):", err);
}

// 2. Register all IPC handlers
registerAllHandlers();

// 2b. Start browser-accessible dev HTTP bridge (port 1421)
startDevServer();

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
  stopPeriodicVerifier();
  shutdownPowerManagement().finally(() => process.exit(0));
});

// 5. Signal readiness
emit("agent.ready", { version: "0.1.0" });

// 5b. Sync focus guard enabled state to the Tauri Rust layer.
// Default is enabled; only emit when the user has explicitly disabled it.
const focusGuardSetting = getSetting("focus_guard_enabled");
if (focusGuardSetting?.value === "false") {
  emit("focus_guard.setEnabled", { enabled: false });
}
console.error(`[agent] ready, listening for IPC on stdin (${elapsed()})`);

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
    captureAgentError(err, { errorCode: "startupDetection" });
  });

// 7. Start scheduler — connects to executor via callback (unless paused)
scheduler.setOnWorkEnqueued(() => executor.processNext());
const schedulerPaused = getSetting("scheduler_paused");
if (schedulerPaused?.value === "true") {
  console.error("[agent] scheduler is paused (persisted setting), skipping start");
} else {
  scheduler.start();
}

// 7b. Initialize power management (non-blocking, non-fatal)
initPowerManagement().catch((err) =>
  console.error("[agent] power management init failed (non-fatal):", err),
);

// 7c. Start periodic license verifier (non-blocking, non-fatal)
try {
  startPeriodicVerifier();
} catch (err) {
  console.error("[agent] license verifier init failed (non-fatal):", err);
}

// Process any re-enqueued runs from crash recovery
executor.processNext();

// 8. Fatal error handlers — log, report to Sentry, and notify frontend before exiting
process.on("uncaughtException", (err) => {
  console.error("[agent] uncaught exception:", err);
  captureAgentError(err, { errorCode: "uncaughtException" });
  try {
    emit("agent.error", {
      type: "uncaughtException",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  } catch {
    // emit itself failed — nothing more we can do
  }
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[agent] unhandled rejection:", reason);
  captureAgentError(reason, { errorCode: "unhandledRejection" });
  try {
    emit("agent.error", {
      type: "unhandledRejection",
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  } catch {
    // emit itself failed — nothing more we can do
  }
  process.exit(1);
});

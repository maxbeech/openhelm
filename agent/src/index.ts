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
import { backfillMissingAutopilotJobs, autopilotScanner } from "./autopilot/index.js";
import { runBackfillIfNeeded } from "./ipc/inbox-bridge.js";
import { backfillMissingVisualizations } from "./data-tables/visualization-suggester.js";
import { reconcileAllRowCounts } from "./db/queries/data-tables.js";
import { usageService } from "./usage/service.js";
import { cleanupOrphanedConfigs } from "./mcp-servers/mcp-config-builder.js";
import { cleanupOrphanedBrowserCredentials } from "./credentials/browser-credentials.js";
import { cleanupOrphanedBrowserPids } from "./mcp-servers/browser-cleanup.js";
import { preWarmEmbedder } from "./memory/embeddings.js";
import { preWarmWhisper } from "./voice/index.js";

// Injected at build time by esbuild define — see agent/scripts/build.mjs
declare const __OPENHELM_VERSION__: string;
const AGENT_VERSION = typeof __OPENHELM_VERSION__ !== "undefined" ? __OPENHELM_VERSION__ : "unknown";

// -- Bootstrap --

const t0 = Date.now();
const elapsed = () => `${Date.now() - t0}ms`;
console.error(`[agent] starting OpenHelm agent v${AGENT_VERSION}`);

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

// 1d. Clean up orphaned MCP config files and browser credential files from previous crashes
try {
  cleanupOrphanedConfigs();
} catch {
  // Non-fatal — directory may not exist yet
}
try {
  cleanupOrphanedBrowserCredentials();
} catch {
  // Non-fatal — directory may not exist yet
}
try {
  cleanupOrphanedBrowserPids();
} catch {
  // Non-fatal — directory may not exist yet
}

// 2. Register all IPC handlers
registerAllHandlers();

// 2b. Start browser-accessible dev HTTP bridge (port 1421)
startDevServer();

// 2c. Reconcile any stale row_count values (rows inserted outside insertDataTableRows)
try {
  reconcileAllRowCounts();
} catch (err) {
  console.error("[agent] row count reconciliation failed (non-fatal):", err);
}

// 3. Crash recovery — must happen after DB init, before scheduler start
try {
  executor.recoverFromCrash();
} catch (err) {
  console.error("[agent] crash recovery failed (non-fatal):", err);
  captureAgentError(err, { errorCode: "crashRecovery" });
}

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
  autopilotScanner.stop();
  stopPeriodicVerifier();
  shutdownPowerManagement().finally(() => process.exit(0));
});

// 5. Signal readiness
emit("agent.ready", { version: AGENT_VERSION });

// 5b. Sync focus guard enabled state to the Tauri Rust layer.
// Default is enabled; only emit when the user has explicitly disabled it.
const focusGuardSetting = getSetting("focus_guard_enabled");
if (focusGuardSetting?.value === "false") {
  emit("focus_guard.setEnabled", { enabled: false });
}
console.error(`[agent] ready, listening for IPC on stdin (${elapsed()})`);

// 5c. Pre-warm embedding model so first chat message doesn't pay load cost
preWarmEmbedder();

// 5d. Pre-warm whisper model if voice is enabled (non-blocking)
preWarmWhisper().catch((err) => {
  console.error("[agent] whisper pre-warm failed (non-fatal):", err);
});

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

// 7d. Start Autopilot scanner (replaces legacy system job backfill)
autopilotScanner.start();

// 7e2. Backfill missing visualizations for data tables with sufficient numeric data
try {
  backfillMissingVisualizations();
} catch (err) {
  console.error("[agent] visualization backfill failed (non-fatal):", err);
}

// 7e3. Backfill inbox events from historic runs and open dashboard items
try {
  runBackfillIfNeeded();
} catch (err) {
  console.error("[agent] inbox backfill failed (non-fatal):", err);
}

// 7e. Initial usage snapshot (non-blocking)
usageService.refresh().catch((err) =>
  console.error("[agent] initial usage refresh failed (non-fatal):", err),
);

// 8. Prevent stdout pipe errors from crashing the agent.
// When the Tauri read-end closes or the pipe buffer breaks, Node.js emits an
// 'error' event on process.stdout. Without a handler this becomes an uncaught
// exception and kills the process.
process.stdout.on("error", (err) => {
  console.error("[agent] stdout pipe error:", err.message);
});

// 9. Fatal error handlers — log and report to Sentry.
// uncaughtException: truly broken state → exit.
// unhandledRejection: a forgotten .catch() → log + notify but keep running.
// Killing the agent on every unhandled rejection is too aggressive for a
// long-running background service; it makes a single async bug (e.g. in
// summarisation or memory extraction) bring down the entire sidecar.
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
  // Give Sentry time to flush the event before exiting.
  // Sentry.close() resolves (or times out) within the given ms.
  import("@sentry/node")
    .then((Sentry) => Sentry.close(2000))
    .catch(() => {})
    .finally(() => process.exit(1));
});

process.on("unhandledRejection", (reason) => {
  console.error("[agent] unhandled rejection (non-fatal):", reason);
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
  // Do NOT exit — the agent should survive async errors
});

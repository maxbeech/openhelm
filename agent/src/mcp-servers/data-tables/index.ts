#!/usr/bin/env node
/**
 * Data Tables MCP Server — lightweight stdio JSON-RPC server
 * that exposes data table CRUD as MCP tools for Claude Code.
 *
 * Spawned per-run by Claude Code via --mcp-config.
 * Connects directly to the SQLite DB (WAL mode supports concurrent access).
 *
 * Protocol: JSON-RPC 2.0 over stdin/stdout (MCP stdio transport).
 * All logging goes to stderr (stdout is reserved for protocol messages).
 */

import { createInterface } from "readline";
import { handleToolCall, TOOL_DEFINITIONS } from "./tools.js";

// ─── CLI args ───
const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const dbPath = getArg("db-path");
const runId = getArg("run-id");
const projectId = getArg("project-id");

if (!dbPath) {
  console.error("[data-tables-mcp] --db-path is required");
  process.exit(1);
}

// ─── Initialize database ───
import { initDatabase } from "../../db/init.js";
initDatabase(dbPath);

console.error(`[data-tables-mcp] started (db=${dbPath}, project=${projectId}, run=${runId})`);

// ─── JSON-RPC helpers ───

function sendResponse(id: string | number | null, result: unknown): void {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, result });
  process.stdout.write(msg + "\n");
}

function sendError(id: string | number | null, code: number, message: string): void {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
  process.stdout.write(msg + "\n");
}

// ─── Message handler ───

function handleMessage(raw: string): void {
  let msg: { jsonrpc?: string; id?: string | number; method?: string; params?: Record<string, unknown> };
  try {
    msg = JSON.parse(raw);
  } catch {
    sendError(null, -32700, "Parse error");
    return;
  }

  const { id, method, params } = msg;

  // Notifications (no id) — just acknowledge silently
  if (id === undefined || id === null) {
    return;
  }

  switch (method) {
    case "initialize":
      sendResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "openhelm_data", version: "1.0.0" },
      });
      break;

    case "tools/list":
      sendResponse(id, { tools: TOOL_DEFINITIONS });
      break;

    case "tools/call": {
      const toolName = params?.name as string;
      const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = handleToolCall(toolName, toolArgs, projectId, runId);
        sendResponse(id, {
          content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendResponse(id, {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        });
      }
      break;
    }

    default:
      sendError(id, -32601, `Method not found: ${method}`);
  }
}

// ─── stdin reader ───

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", handleMessage);
rl.on("close", () => {
  console.error("[data-tables-mcp] stdin closed, shutting down");
  process.exit(0);
});

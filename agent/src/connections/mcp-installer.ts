/**
 * MCP server installer — runs the install command in a child process and
 * emits `connection.installProgress` events.
 *
 * Safety contract:
 *   - Only runners in ALLOWED_RUNNERS are ever executed.
 *   - The install command comes from the MCP registry server entry — never
 *     freeform user input.
 */

import { spawn } from "child_process";
import * as connQueries from "../db/queries/connections.js";
import { emit } from "../ipc/emitter.js";

/** Runners allowed for local installs. Any other binary is rejected. */
const ALLOWED_RUNNERS = new Set(["npx", "npm", "pipx", "uvx", "uv", "brew"]);

export interface InstallMcpParams {
  connectionId: string;
  installCommand: string[];
}

/**
 * Install an MCP server for the given connection.
 *
 * Updates `install_status` on the connection row and emits progress events.
 * Resolves when installation completes (success or failure).
 */
export async function installMcpServer(params: InstallMcpParams): Promise<void> {
  const { connectionId, installCommand } = params;

  if (!installCommand || installCommand.length === 0) {
    // No install needed (e.g. HTTP transport servers)
    connQueries.updateConnection({ id: connectionId, installStatus: "installed" });
    return;
  }

  const [runner, ...args] = installCommand;

  if (!ALLOWED_RUNNERS.has(runner)) {
    const msg = `Disallowed MCP install runner: "${runner}". Allowed: ${[...ALLOWED_RUNNERS].join(", ")}`;
    console.error(`[mcp-installer] ${msg}`);
    connQueries.updateConnection({ id: connectionId, installStatus: "failed", installError: msg });
    emit("connection.installProgress", { connectionId, status: "failed", message: msg });
    return;
  }

  connQueries.updateConnection({ id: connectionId, installStatus: "installing" });
  emit("connection.installProgress", { connectionId, status: "installing", message: `Running: ${installCommand.join(" ")}` });

  return new Promise((resolve) => {
    const child = spawn(runner, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5 * 60 * 1000, // 5-minute install budget
    });

    const lines: string[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) {
        lines.push(line);
        emit("connection.installProgress", { connectionId, status: "installing", message: line });
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) {
        lines.push(line);
        emit("connection.installProgress", { connectionId, status: "installing", message: line });
      }
    });

    child.on("close", (code) => {
      if (code === 0) {
        connQueries.updateConnection({ id: connectionId, installStatus: "installed" });
        emit("connection.installProgress", { connectionId, status: "installed", message: "Installation complete" });
      } else {
        const error = lines.slice(-5).join("\n") || `Exited with code ${code}`;
        connQueries.updateConnection({ id: connectionId, installStatus: "failed", installError: error });
        emit("connection.installProgress", { connectionId, status: "failed", message: error });
      }
      resolve();
    });

    child.on("error", (err) => {
      const msg = err.message;
      connQueries.updateConnection({ id: connectionId, installStatus: "failed", installError: msg });
      emit("connection.installProgress", { connectionId, status: "failed", message: msg });
      resolve();
    });
  });
}

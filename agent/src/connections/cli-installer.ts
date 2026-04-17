/**
 * CLI connection installer and auth orchestrator.
 *
 * Handles:
 *   1. Running the CLI's install command (same allowed-runner whitelist as MCP).
 *   2. Detecting the auth method (device code / browser / token paste).
 *   3. Starting the CLI auth command and polling auth file paths for completion.
 *   4. Completing auth once the CLI has written its credentials.
 */

import { spawn, execFile } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import * as connQueries from "../db/queries/connections.js";
import { emit } from "../ipc/emitter.js";
import { getCliCatalogue } from "./cli-catalogue.js";
import type { CliConfig } from "@openhelm/shared";

const ALLOWED_RUNNERS = new Set(["npx", "npm", "pipx", "brew", "curl", "apt-get", "apt"]);
const AUTH_POLL_INTERVAL_MS = 2_000;
const AUTH_POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Return the absolute path for an auth file glob (expands ~). */
function expandAuthPath(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/** Check if any of the CLI's auth file paths exist, indicating authenticated state. */
function isAuthFilePresent(authFilePaths: string[]): boolean {
  return authFilePaths.some((p) => existsSync(expandAuthPath(p)));
}

/** Install a CLI by running its install command. */
export async function installCli(params: {
  connectionId: string;
  installCommand: string[];
}): Promise<void> {
  const { connectionId, installCommand } = params;

  if (!installCommand || installCommand.length === 0) {
    connQueries.updateConnection({ id: connectionId, installStatus: "installed" });
    return;
  }

  const [runner, ...args] = installCommand;
  if (!ALLOWED_RUNNERS.has(runner)) {
    const msg = `Disallowed CLI install runner: "${runner}"`;
    connQueries.updateConnection({ id: connectionId, installStatus: "failed", installError: msg });
    emit("connection.installProgress", { connectionId, status: "failed", message: msg });
    return;
  }

  connQueries.updateConnection({ id: connectionId, installStatus: "installing" });
  emit("connection.installProgress", { connectionId, status: "installing", message: `Running: ${installCommand.join(" ")}` });

  await new Promise<void>((resolve) => {
    const child = spawn(runner, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5 * 60 * 1000,
    });

    child.stdout.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) emit("connection.installProgress", { connectionId, status: "installing", message: line });
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) emit("connection.installProgress", { connectionId, status: "installing", message: line });
    });

    child.on("close", (code) => {
      if (code === 0) {
        connQueries.updateConnection({ id: connectionId, installStatus: "installed" });
        emit("connection.installProgress", { connectionId, status: "installed", message: "Installation complete" });
      } else {
        const msg = `CLI install exited with code ${code}`;
        connQueries.updateConnection({ id: connectionId, installStatus: "failed", installError: msg });
        emit("connection.installProgress", { connectionId, status: "failed", message: msg });
      }
      resolve();
    });

    child.on("error", (err) => {
      connQueries.updateConnection({ id: connectionId, installStatus: "failed", installError: err.message });
      emit("connection.installProgress", { connectionId, status: "failed", message: err.message });
      resolve();
    });
  });
}

export interface CliAuthStartResult {
  method: "device_code" | "browser" | "token_paste";
  deviceCode?: string;
  verificationUrl?: string;
  instructions: string;
}

/**
 * Start CLI authentication.
 *
 * Spawns the CLI's auth command, emits its output as progress events,
 * and returns a result indicating what the frontend should display
 * (device code, browser redirect, or token paste form).
 *
 * The auth command runs detached — the frontend calls `completeCliAuth`
 * to poll for completion.
 */
export async function startCliAuth(params: {
  connectionId: string;
}): Promise<CliAuthStartResult> {
  const conn = connQueries.getConnection(params.connectionId);
  if (!conn) throw new Error(`Connection not found: ${params.connectionId}`);

  const config = conn.config as CliConfig;
  const cliEntry = getCliCatalogue().find((c) => c.id === config.cliId);
  if (!cliEntry) throw new Error(`CLI not found in catalogue: ${config.cliId}`);
  if (!cliEntry.authCommand || cliEntry.authCommand.length === 0) {
    // No auth command — mark as authenticated if auth files already exist
    if (isAuthFilePresent(cliEntry.authFilePaths)) {
      connQueries.updateConnection({ id: params.connectionId, authStatus: "authenticated" });
    }
    return {
      method: "browser",
      instructions: `${cliEntry.name} does not require an explicit auth command. Credentials are managed externally.`,
    };
  }

  const [runner, ...args] = cliEntry.authCommand;
  const child = spawn(runner, args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  let outputBuffer = "";
  let deviceCode: string | undefined;
  let verificationUrl: string | undefined;

  const parseOutput = (text: string) => {
    outputBuffer += text;
    emit("connection.authProgress", { connectionId: params.connectionId, message: text.trim() });

    // Device code detection: look for patterns like "Enter code: XXXX-XXXX" or URLs
    const codeMatch = outputBuffer.match(/[Cc]ode[:\s]+([A-Z0-9]{4}-[A-Z0-9]{4})/);
    if (codeMatch && !deviceCode) deviceCode = codeMatch[1];

    const urlMatch = outputBuffer.match(/https?:\/\/[^\s\n"']+/);
    if (urlMatch && !verificationUrl) verificationUrl = urlMatch[0];
  };

  child.stdout.on("data", (chunk: Buffer) => parseOutput(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => parseOutput(chunk.toString()));

  // Give the auth command 3 seconds to produce initial output before returning
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 3_000);
    child.on("close", () => { clearTimeout(timer); resolve(); });
    child.on("error", () => { clearTimeout(timer); resolve(); });
  });

  if (deviceCode || verificationUrl?.includes("device")) {
    return {
      method: "device_code",
      deviceCode,
      verificationUrl,
      instructions: outputBuffer.trim() || `Authenticate ${cliEntry.name} using the device code above.`,
    };
  }

  if (verificationUrl) {
    return {
      method: "browser",
      verificationUrl,
      instructions: outputBuffer.trim() || `Open the URL above to authenticate ${cliEntry.name}.`,
    };
  }

  return {
    method: "token_paste",
    instructions: outputBuffer.trim() || `Paste your ${cliEntry.name} token to complete authentication.`,
  };
}

/**
 * Poll for CLI auth completion by checking whether the CLI's auth files exist.
 * Updates the connection's `authStatus` when done.
 * Times out after AUTH_POLL_TIMEOUT_MS.
 */
export async function completeCliAuth(params: {
  connectionId: string;
}): Promise<{ authenticated: boolean; timedOut: boolean }> {
  const conn = connQueries.getConnection(params.connectionId);
  if (!conn) throw new Error(`Connection not found: ${params.connectionId}`);

  const config = conn.config as CliConfig;
  const cliEntry = getCliCatalogue().find((c) => c.id === config.cliId);
  if (!cliEntry) throw new Error(`CLI not found in catalogue: ${config.cliId}`);

  const deadline = Date.now() + AUTH_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (isAuthFilePresent(cliEntry.authFilePaths)) {
      connQueries.updateConnection({ id: params.connectionId, authStatus: "authenticated" });
      emit("connection.authProgress", { connectionId: params.connectionId, message: "Authentication complete" });
      return { authenticated: true, timedOut: false };
    }
    await new Promise<void>((r) => setTimeout(r, AUTH_POLL_INTERVAL_MS));
  }

  connQueries.updateConnection({ id: params.connectionId, authStatus: "unauthenticated" });
  return { authenticated: false, timedOut: true };
}

/**
 * For cloud-mode runs: extract the CLI auth files into a tar.gz bundle
 * and return the buffer. The caller stores this in Supabase Storage.
 */
export async function bundleCliAuthFiles(connectionId: string): Promise<Buffer | null> {
  const conn = connQueries.getConnection(connectionId);
  if (!conn) return null;

  const config = conn.config as CliConfig;
  const cliEntry = getCliCatalogue().find((c) => c.id === config.cliId);
  if (!cliEntry) return null;

  const existingPaths = cliEntry.authFilePaths
    .map(expandAuthPath)
    .filter(existsSync);

  if (existingPaths.length === 0) return null;

  return new Promise((resolve) => {
    const args = ["-czf", "-", ...existingPaths];
    execFile("tar", args, { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        console.error("[cli-installer] tar bundle error:", err.message);
        resolve(null);
      } else {
        resolve(stdout as unknown as Buffer);
      }
    });
  });
}

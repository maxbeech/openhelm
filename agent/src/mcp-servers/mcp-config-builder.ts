/**
 * Generates MCP config JSON for Claude Code's --mcp-config flag.
 *
 * Writes a per-run config file to ~/.openhelm/mcp-configs/ that tells
 * Claude Code how to start the built-in browser MCP server. The file is
 * cleaned up after the run completes.
 */

import { writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { getBrowserMcpPaths, type BrowserMcpPaths } from "./browser-setup.js";

/**
 * Prepended to job prompts when the bundled browser MCP is available.
 */
export const BROWSER_MCP_PREAMBLE =
  "Use the openhelm-browser MCP for browser automation. Close all browser instances when done.\n\n";

/**
 * Injected as a system-level instruction via --append-system-prompt when the
 * bundled browser MCP is available. System prompts are far more authoritative
 * than user-prompt preambles and virtually guarantee Claude uses the right MCP.
 */
export const BROWSER_SYSTEM_PROMPT =
  "CRITICAL RULE: You MUST use the `openhelm-browser` MCP server for ALL browser automation — " +
  "spawning browsers, navigating, clicking, screenshots, etc. " +
  "NEVER use stealth-browser-mcp, chrome-devtools, or any other browser MCP unless " +
  "the user's prompt explicitly names a specific alternative by name. " +
  "This is a hard requirement, not a preference.";

/**
 * Prepended to job prompts to instruct Claude on CAPTCHA handling.
 * Covers detection, auto-solve attempts, alternative reasoning, and
 * user intervention request with polling loop.
 */
export const BROWSER_CAPTCHA_PREAMBLE =
  "If you hit a CAPTCHA, call detect_captcha and follow auto_solve_hint. " +
  "If unsolvable, call request_user_help and poll screenshots every 30s for up to 5 minutes.\n\n";

/**
 * Prepended to job prompts when the data tables MCP is available.
 */
export const DATA_TABLES_MCP_PREAMBLE =
  "Data tables are available via openhelm-data MCP tools. Check existing tables before creating new ones.\n\n";

export const BROWSER_CREDENTIALS_PREAMBLE =
  "Browser credentials are pre-loaded. Call list_browser_credentials to see available credentials.\n\n";

const MCP_CONFIG_DIR = join(
  process.env.OPENHELM_DATA_DIR ?? join(homedir(), ".openhelm"),
  "mcp-configs",
);

export interface McpServerEntry {
  command: string;
  args: string[];
  cwd?: string;
}

export interface McpConfigFile {
  mcpServers: Record<string, McpServerEntry>;
}

/**
 * Resolve the path to the data-tables MCP server bundle.
 * In development: dist/mcp-data-tables.js (built by esbuild).
 * In production: alongside the agent binary in Contents/MacOS/.
 */
function getDataTablesMcpPath(): string | null {
  const candidates = [
    join(__dirname, "mcp-data-tables.js"),                // production (same dir as agent)
    join(__dirname, "..", "dist", "mcp-data-tables.js"),  // dev (from src/)
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  console.error("[mcp-config] WARNING: mcp-data-tables.js not found in any candidate path");
  return null;
}

/**
 * Get the SQLite database path used by the agent.
 */
function getDbPath(): string {
  return join(
    process.env.OPENHELM_DATA_DIR ?? join(homedir(), ".openhelm"),
    "openhelm.db",
  );
}

/**
 * Build the MCP config object for a run.
 *
 * Contains only the bundled OpenHelm MCP servers (browser + data tables).
 * Passed via --mcp-config to ADD these servers on top of the user's existing
 * global (~/.claude.json) and project-level (.mcp.json) servers — Claude Code
 * merges them automatically. No --strict-mcp-config is used, so the user's
 * full MCP environment is preserved.
 *
 * Returns null if no bundled servers are available.
 *
 * @param runId — OpenHelm run ID, passed as `--run-id` for intervention context.
 * @param credentialsFilePath — path to a temp JSON file containing browser-injectable credentials.
 * @param projectId — project ID, passed to the data tables MCP server.
 */
export function buildMcpConfig(runId: string, credentialsFilePath?: string, projectId?: string): McpConfigFile | null {
  const servers: Record<string, McpServerEntry> = {};

  // Bundled openhelm-browser (when venv is ready)
  const browserPaths = getBrowserMcpPaths();
  if (browserPaths) {
    const args = [
      browserPaths.serverModule,
      "--transport", "stdio",
      "--run-id", runId,
      "--disable-progressive-cloning",
      "--disable-file-extraction",
      "--disable-element-extraction",
      "--disable-dynamic-hooks",
      "--disable-debugging",
      "--disable-cdp-functions",
      "--block-resources-default", "font,media",
    ];
    if (credentialsFilePath) {
      args.push("--credentials-file", credentialsFilePath);
    }
    servers["openhelm-browser"] = {
      command: browserPaths.pythonPath,
      args,
      cwd: browserPaths.cwd,
    };
  }

  // Bundled openhelm-data (data tables MCP)
  const dataTablesMcpPath = getDataTablesMcpPath();
  if (dataTablesMcpPath) {
    const dtArgs = [dataTablesMcpPath, "--db-path", getDbPath(), "--run-id", runId];
    if (projectId) {
      dtArgs.push("--project-id", projectId);
    }
    servers["openhelm-data"] = {
      command: process.execPath,
      args: dtArgs,
    };
  }

  if (Object.keys(servers).length === 0) return null;
  return { mcpServers: servers };
}

/**
 * Write the MCP config to a file and return the path.
 * Returns null if no bundled MCP servers are available.
 *
 * @param credentialsFilePath — forwarded to buildMcpConfig for browser credential injection.
 * @param projectId — forwarded to buildMcpConfig for data tables MCP server.
 */
export function writeMcpConfigFile(runId: string, credentialsFilePath?: string, projectId?: string): string | null {
  const config = buildMcpConfig(runId, credentialsFilePath, projectId);
  if (!config) return null;

  mkdirSync(MCP_CONFIG_DIR, { recursive: true });
  const configPath = join(MCP_CONFIG_DIR, `run-${runId}.json`);
  // Write with 0600 permissions — the file contains the credentials file path,
  // so limit visibility to the current user only.
  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  return configPath;
}

/** Remove a previously written MCP config file (post-run cleanup). */
export function removeMcpConfigFile(configPath: string): void {
  try {
    unlinkSync(configPath);
  } catch {
    // File already removed or doesn't exist — ignore
  }
}

/**
 * Sweep orphaned config files from ~/.openhelm/mcp-configs/.
 * Called at agent startup to clean up after crashes.
 */
export function cleanupOrphanedConfigs(): void {
  try {
    const files = readdirSync(MCP_CONFIG_DIR);
    for (const file of files) {
      if (file.startsWith("run-") && file.endsWith(".json")) {
        try {
          unlinkSync(join(MCP_CONFIG_DIR, file));
        } catch {
          // ignore
        }
      }
    }
    if (files.length > 0) {
      console.error(`[mcp-config] cleaned up ${files.length} orphaned config file(s)`);
    }
  } catch {
    // Directory doesn't exist yet — nothing to clean
  }
}

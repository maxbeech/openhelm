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
  "IMPORTANT: You MUST use `mcp__openhelm-browser__spawn_browser` to open any browser. " +
  "Do NOT use chrome-devtools, stealth-browser-mcp, or any other browser tool. " +
  "Close all browser instances with `mcp__openhelm-browser__close_instance` when done.\n\n";

/**
 * Injected as a system-level instruction via --append-system-prompt when the
 * bundled browser MCP is available. System prompts are far more authoritative
 * than user-prompt preambles and virtually guarantee Claude uses the right MCP.
 */
export const BROWSER_SYSTEM_PROMPT =
  "BROWSER AUTOMATION RULE (mandatory, no exceptions): " +
  "The ONLY browser tool you may call is `mcp__openhelm-browser__spawn_browser` and the other `mcp__openhelm-browser__*` tools. " +
  "You MUST NOT call any tool from chrome-devtools, stealth-browser-mcp, or any MCP server other than openhelm-browser for browser automation. " +
  "If openhelm-browser tools are unavailable or return an error, stop and report the error — do NOT fall back to another browser MCP. " +
  "Always call `mcp__openhelm-browser__close_instance` for every browser instance you open before finishing.";

/**
 * Prepended to job prompts to instruct Claude on CAPTCHA handling.
 * Covers detection, auto-solve attempts, alternative reasoning, and
 * user intervention request with polling loop.
 */
export const BROWSER_CAPTCHA_PREAMBLE =
  "CAPTCHA HANDLING (mandatory):\n" +
  "- navigate(), go_back(), go_forward(), and reload_page() automatically detect CAPTCHAs. " +
  "If the response contains captcha_detected=true, you MUST immediately call " +
  "request_user_help with the reason from captcha_action_required. Do NOT close the browser.\n" +
  "- After calling request_user_help, poll with take_screenshot every 30s for up to 15 minutes. " +
  "Output a status line each poll to prevent silence timeout.\n" +
  "- If a page looks wrong, empty, or shows 'Just a moment...', check the response for captcha_detected " +
  "before giving up.\n" +
  "- NEVER close a browser instance that has an unresolved CAPTCHA.\n\n";

/**
 * Prepended to job prompts to instruct Claude on persistent profile usage
 * and authenticated session handling.
 */
export const BROWSER_PROFILE_PREAMBLE =
  "PERSISTENT BROWSER PROFILES (mandatory): NEVER spawn a browser without a profile. " +
  "When credentials are listed above with a profile name, " +
  "ALWAYS use that exact profile in spawn_browser(profile=...) to reuse the saved session. " +
  "If no credential-linked profile exists, use a default profile named after the project slug. " +
  "Do NOT create new profile names or use 'default' when a credential-linked profile exists. " +
  "Profiles preserve cookies, localStorage, and browser state between runs — this is critical for avoiding bot detection. " +
  "After spawning, call check_session(instance_id, domain) to verify login status. " +
  "If the session is expired, call auto_login with the credential name. " +
  "If auto_login also fails, call request_user_help for manual login.\n\n";

/**
 * Prepended to job prompts when the data tables MCP is available.
 */
export const DATA_TABLES_MCP_PREAMBLE =
  "Data tables are available via openhelm-data MCP tools. Check existing tables before creating new ones.\n\n";

/**
 * Injected as a system-level instruction on EVERY run via --append-system-prompt.
 * Prevents Claude from asking clarifying questions instead of executing.
 *
 * Claude Code in --print mode sometimes summarises the task and asks
 * "Should I start?" or "Would you like me to...?" before doing any work.
 * This instruction eliminates that behaviour.
 */
export const EXECUTION_SYSTEM_PROMPT =
  "EXECUTION MODE (mandatory, no exceptions): " +
  "You are running in fully automated, non-interactive mode inside OpenHelm. " +
  "Execute every step in the task immediately, starting from step 1. " +
  "Do NOT ask the user for confirmation, approval, or clarification. " +
  "Do NOT summarise the task back and ask 'Should I start?', 'Would you like me to...', " +
  "'Shall I proceed?', or any similar question — just start executing. " +
  "If something is ambiguous, make a reasonable choice and proceed. " +
  "Only stop if you hit a genuine, unrecoverable blocker (e.g. missing credentials, " +
  "inaccessible resource) — in that case, report the specific blocker and stop. " +
  "There is no human watching this session, so questions will never be answered.";

/**
 * Produce an explicit browser-credentials notice for the job prompt based on
 * which credentials are actually bound to this run. This prevents Claude from
 * hallucinating credential names and blindly calling auto_login when nothing
 * is actually loaded (which wastes turns and tokens).
 *
 * Each credential may have an associated persistent browser profile. When
 * present, Claude should spawn_browser with that profile to reuse saved
 * cookies/sessions — auto_login is only needed if the session has expired.
 */
export function buildBrowserCredentialsNotice(
  credentials: Array<{ name: string; type: "username_password" | "token"; profileName?: string }>,
): string {
  if (credentials.length === 0) {
    return (
      "BROWSER CREDENTIALS: No credentials are bound to this project/job. " +
      "`list_browser_credentials` will return an empty array, and `auto_login` " +
      "WILL fail. Do NOT guess credential names. " +
      "If the task requires a logged-in session, first try a persistent profile " +
      "via `spawn_browser(profile=\"default\")` — if that session is also expired, " +
      "call `request_user_help` so the user can log in manually in the visible window, " +
      "then poll for completion. If no profile is authenticated either, stop and " +
      "report that credentials are missing — do not attempt to create an account.\n\n"
    );
  }
  const lines = credentials.map((c) => {
    const profileHint = c.profileName
      ? ` → spawn_browser(profile="${c.profileName}") for pre-authenticated session`
      : "";
    return `  - "${c.name}" (${c.type})${profileHint}`;
  }).join("\n");
  return (
    "BROWSER CREDENTIALS (pre-loaded for this run — use the exact names below):\n" +
    lines +
    "\n\nWORKFLOW: For each site, first `spawn_browser` with the credential's profile " +
    "(listed above) to reuse the saved session. Call `check_session` to verify. " +
    "Only if the session is expired, fall back to `auto_login` with the credential name. " +
    "If auto_login also fails, call `request_user_help` for manual login.\n\n"
  );
}

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

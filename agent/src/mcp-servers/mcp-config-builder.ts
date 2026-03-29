/**
 * Generates MCP config JSON for Claude Code's --mcp-config flag.
 *
 * Writes a per-run config file to ~/.openhelm/mcp-configs/ that tells
 * Claude Code how to start the built-in browser MCP server. The file is
 * cleaned up after the run completes.
 */

import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getBrowserMcpPaths, type BrowserMcpPaths } from "./browser-setup.js";

/**
 * Prepended to job prompts when the built-in browser MCP is available.
 * Encourages Claude to prefer openhelm-browser over any other browser MCP
 * configured globally, unless the prompt explicitly requests a different one.
 */
export const BROWSER_MCP_PREAMBLE =
  'OpenHelm: A built-in browser MCP server is available as "openhelm-browser". ' +
  "For any browser automation, prefer the mcp__openhelm-browser__* tools — " +
  "they include per-operation timeout protection. Only use a different browser " +
  "MCP if the task explicitly requests one. " +
  "When your task is complete, close all browser instances using " +
  "mcp__openhelm-browser__close_instance before finishing.\n\n";

/**
 * Prepended to job prompts to instruct Claude on CAPTCHA handling.
 * Covers detection, auto-solve attempts, alternative reasoning, and
 * user intervention request with polling loop.
 */
export const BROWSER_CAPTCHA_PREAMBLE =
  "CAPTCHA Handling: When browsing, be alert for robot checks. After navigating " +
  "or if a page looks like a verification challenge:\n" +
  "1. Call mcp__openhelm-browser__detect_captcha to confirm the type.\n" +
  "2. If auto_solve_hint suggests it can be solved:\n" +
  "   - Checkbox CAPTCHAs (reCAPTCHA v2, hCaptcha): click the checkbox element.\n" +
  "   - Cloudflare Turnstile: wait 10-15 seconds (often auto-resolves).\n" +
  "   - Image challenges: take a screenshot, analyze the images using your vision,\n" +
  "     and click the correct ones. Retry up to 3 times if needed.\n" +
  "   - Text CAPTCHAs: take a screenshot, read the distorted text, type it in.\n" +
  "   - Verify success by taking another screenshot.\n" +
  "3. If unsolvable, consider alternatives:\n" +
  "   - Different URL or API endpoint without CAPTCHA protection.\n" +
  "   - Alternative method to accomplish the same goal.\n" +
  "4. If no alternatives exist, call mcp__openhelm-browser__request_user_help\n" +
  "   explaining what needs to be done. Then poll every 30 seconds: take a\n" +
  "   screenshot and check if the CAPTCHA is gone. Output 'Waiting for user to\n" +
  "   solve CAPTCHA on [url]...' each time. Give up after 5 minutes.\n\n";

export const BROWSER_CREDENTIALS_PREAMBLE =
  "Browser credentials are pre-loaded securely into the browser MCP server. " +
  "Use mcp__openhelm-browser__list_browser_credentials to see what is available, " +
  "then mcp__openhelm-browser__auto_login, mcp__openhelm-browser__inject_auth_cookie, " +
  "or mcp__openhelm-browser__inject_auth_header to use them. " +
  "Never ask the user for credential values — they are already loaded.\n\n";

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
 * Build the MCP config object for a run.
 * Returns null if no MCP servers are available (venv not set up).
 *
 * @param runId — OpenHelm run ID, passed as `--run-id` for intervention context.
 * @param credentialsFilePath — path to a temp JSON file containing browser-injectable credentials.
 *   Passed as `--credentials-file` arg to the browser MCP server.
 */
export function buildMcpConfig(runId: string, credentialsFilePath?: string): McpConfigFile | null {
  const servers: Record<string, McpServerEntry> = {};

  const browserPaths = getBrowserMcpPaths();
  if (browserPaths) {
    const args = [browserPaths.serverModule, "--transport", "stdio", "--run-id", runId];
    if (credentialsFilePath) {
      args.push("--credentials-file", credentialsFilePath);
    }
    servers["openhelm-browser"] = {
      command: browserPaths.pythonPath,
      args,
      cwd: browserPaths.cwd,
    };
  }

  if (Object.keys(servers).length === 0) return null;
  return { mcpServers: servers };
}

/**
 * Write the MCP config to a file and return the path.
 * Returns null if no MCP servers are available.
 *
 * @param credentialsFilePath — forwarded to buildMcpConfig for browser credential injection.
 */
export function writeMcpConfigFile(runId: string, credentialsFilePath?: string): string | null {
  const config = buildMcpConfig(runId, credentialsFilePath);
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

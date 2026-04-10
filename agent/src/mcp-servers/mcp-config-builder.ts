/**
 * Generates MCP config JSON for Claude Code's --mcp-config flag.
 *
 * Writes a per-run config file to ~/.openhelm/mcp-configs/ that tells
 * Claude Code how to start the built-in browser MCP server. The file is
 * cleaned up after the run completes.
 */

import { writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { getBrowserMcpPaths, type BrowserMcpPaths } from "./browser-setup.js";

/**
 * Prepended to job prompts when the bundled browser MCP is available.
 */
export const BROWSER_MCP_PREAMBLE =
  "IMPORTANT: You MUST use `mcp__openhelm_browser__spawn_browser` to open any browser. " +
  "Do NOT use chrome-devtools, stealth-browser-mcp, or any other browser tool. " +
  "Close all browser instances with `mcp__openhelm_browser__close_instance` when done.\n\n" +
  "EFFICIENT BROWSING (mandatory order of operations):\n" +
  "1. After EVERY navigate/reload, your FIRST tool call MUST be `get_page_digest` — no exceptions. " +
  "It returns a compact outline (~10K tokens) of headings, links, buttons, and text. " +
  "Do NOT call `query_elements`, `find_on_page`, `find_by_role`, or `take_screenshot` before `get_page_digest`.\n" +
  "2. Read the digest to decide what to click/type. The digest shows visible labels you can pass to `find_on_page`.\n" +
  "3. Use `find_on_page(query)` (with text/selector from the digest) to locate and auto-scroll to an element — returns a selector_hint.\n" +
  "4. Use the selector_hint with `click_element`. Prefer `find_on_page` over `find_by_role` — role+name matching is fragile on SPAs.\n" +
  "5. Use `scroll_page` (returns percent, at_bottom, pages_remaining) to move through a page — NEVER screenshot to check scroll position.\n" +
  "6. Only use `take_screenshot` when you need VISUAL understanding (layout, images, CAPTCHA). Use `max_width=800, grayscale=true` to cut tokens.\n" +
  "If `get_page_digest` or `find_by_role` returns a timeout error, the page DOM is stuck — call `reload_page` once, then fall back to `take_screenshot(max_width=800, grayscale=true)`. Do NOT retry the same timing-out tool more than once.\n\n" +
  "FORM INPUT + SUBMISSION VERIFICATION (mandatory — stops false positives):\n" +
  "A. NEVER pass a comma-separated union selector (e.g. `textarea, [contenteditable], input[type=\"text\"]`) to `paste_text`/`type_text`/`click_element`. Unions routinely match the search box first. Use `find_on_page(\"Add a comment\")`, `find_on_page(\"Join the conversation\")`, or `find_on_page(\"Reply\")` and pass the returned `selector_hint`.\n" +
  "B. `paste_text` and `type_text` now return a VERIFICATION DICT — NOT a bool. After calling, you MUST check:\n" +
  "   - `verified` is true,\n" +
  "   - `inserted_chars` ≈ `expected_chars`,\n" +
  "   - `resolved_target.editor_kind` is `contenteditable` or `textarea` (not `input-search`),\n" +
  "   - `warnings` is empty.\n" +
  "   If verified is false OR warnings mention a search input OR editor_kind is `input-search`, DO NOT click submit — go back, use `find_on_page` with a more specific phrase, and retry.\n" +
  "C. After clicking any submit/post/publish/reply button, your VERY NEXT call MUST be `get_page_digest`. Confirm the editor closed, the new comment/post appears, or a success toast is visible. If none of those are true, the submission did NOT succeed — do not claim success. Retry or report the blocker.\n" +
  "D. Collapsed comment widgets (Reddit, Twitter, LinkedIn) are handled automatically: `paste_text`/`type_text` detect both hidden editors AND visible trigger wrappers (custom elements like `<faceplate-textarea-input>`, `<shreddit-composer>`), click them, wait for the real editor to mount, and auto-fall-back to a generic `textarea, [contenteditable]` scan to find the revealed editor. You do NOT need to manually switch selectors after clicking a composer trigger — just pass the same selector you used for `find_on_page` / `click_element` and paste_text will re-target. If paste_text still returns `verified: false` after auto-expand, check `resolved_target.fallback_editor_used` and `activator_clicked` — if both are true and it STILL failed, the composer wants a real mouse gesture: call `click_element` on the activator selector, then `get_page_digest`, then retry. Do NOT give up after a single failed paste_text — retry at least twice with different approaches before abandoning the thread.\n" +
  "E. `find_on_page(query)` is the most reliable way to locate a specific piece of UI. It accepts plain text (case-insensitive), CSS selectors, and XPath (starting with `//`), and always returns a `selector_hint` of the form `[data-oh-find=\"1\"]` or similar that you can pass directly to `click_element`/`paste_text`. Note: on Reddit, find_on_page for 'Join the conversation' returns a selector for the trigger WRAPPER, not the editor itself — but paste_text handles this automatically (see rule D). Use the same selector_hint for both `click_element` and the subsequent `paste_text`.\n\n";

/**
 * Injected as a system-level instruction via --append-system-prompt when the
 * bundled browser MCP is available. System prompts are far more authoritative
 * than user-prompt preambles and virtually guarantee Claude uses the right MCP.
 */
export const BROWSER_SYSTEM_PROMPT =
  "BROWSER AUTOMATION RULE (mandatory, no exceptions): " +
  "The ONLY browser tool you may call is `mcp__openhelm_browser__spawn_browser` and the other `mcp__openhelm_browser__*` tools. " +
  "You MUST NOT call any tool from chrome-devtools, stealth-browser-mcp, or any MCP server other than openhelm_browser for browser automation. " +
  "If openhelm_browser tools are unavailable or return an error, stop and report the error — do NOT fall back to another browser MCP. " +
  "Always call `mcp__openhelm_browser__close_instance` for every browser instance you open before finishing.";

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
  "PERSISTENT BROWSER PROFILES (mandatory):\n" +
  "- `spawn_browser` takes `profile=\"<name>\"` to reuse a persistent Chrome profile (cookies, localStorage, logged-in sessions). It does NOT take `instance_id`, `name`, `session_name`, or `id` — the returned instance_id is auto-generated.\n" +
  "- If a credential is listed below with a profile name, you MUST use that exact profile name on spawn. Do NOT invent a new profile name for that site.\n" +
  "- If no credential-linked profile exists for the target site, omit `profile` entirely (or explicitly pass `profile=\"default\"`) — the tool defaults to the shared `default` profile. This keeps cookies between runs and is what bypasses Reddit/Cloudflare fresh-browser bot checks.\n" +
  "- DO NOT invent per-task profile names like `\"search_session\"`, `\"hn_browser\"`, `\"reddit_task\"`. Those create brand-new empty profiles every run, which is equivalent to having no profile at all. Reuse existing named profiles or fall back to `default`.\n" +
  "- After spawning, call `check_session(instance_id, domain)` on any site that needs login. If the session is expired, call `auto_login` with the credential name. If auto_login also fails, call `request_user_help` for manual login.\n" +
  "- If the first `navigate` lands on an anti-bot page ('Prove your humanity', 'Just a moment', 'Checking your browser'), DO NOT immediately close the instance and move on. Try: (1) wait 3s and `reload_page` once, (2) if still blocked, re-spawn with the site's dedicated profile (e.g. `profile=\"reddit\"`, `profile=\"xcom\"`) — existing cookies often bypass the check, (3) only call `request_user_help` or abandon the platform if both fail. Do NOT skip a whole target platform after a single flake.\n\n";

/**
 * Prepended to job prompts when the data tables MCP is available.
 */
export const DATA_TABLES_MCP_PREAMBLE =
  "Data tables are available via openhelm_data MCP tools. Check existing tables before creating new ones.\n\n";

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
      "If the task requires a logged-in session, call `spawn_browser` WITHOUT a " +
      "`profile` kwarg (or explicitly pass `spawn_browser(profile=\"default\")`) — " +
      "the tool defaults to the shared `default` profile, which preserves any cookies/sessions from previous " +
      "runs. If that session is expired, call `request_user_help` so the user can log " +
      "in manually in the visible window, then poll for completion. Do not attempt to " +
      "create an account.\n\n"
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

  // Bundled openhelm_browser (when venv is ready)
  const browserPaths = getBrowserMcpPaths();
  if (browserPaths) {
    // Validate all referenced paths exist before including in config.
    // A bad path here means the MCP server will fail to start, causing
    // "No such tool available" errors that waste the entire run.
    const pathsOk =
      existsSync(browserPaths.pythonPath) &&
      existsSync(browserPaths.serverModule) &&
      existsSync(browserPaths.cwd);
    if (!pathsOk) {
      console.error(
        "[mcp-config] browser MCP paths invalid — skipping:",
        JSON.stringify({
          python: existsSync(browserPaths.pythonPath),
          server: existsSync(browserPaths.serverModule),
          cwd: existsSync(browserPaths.cwd),
        }),
      );
    } else {
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
      servers["openhelm_browser"] = {
        command: browserPaths.pythonPath,
        args,
        cwd: browserPaths.cwd,
      };
    }
  }

  // Bundled openhelm_data (data tables MCP)
  const dataTablesMcpPath = getDataTablesMcpPath();
  if (dataTablesMcpPath) {
    const dtArgs = [dataTablesMcpPath, "--db-path", getDbPath(), "--run-id", runId];
    if (projectId) {
      dtArgs.push("--project-id", projectId);
    }
    servers["openhelm_data"] = {
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
  const jsonStr = JSON.stringify(config, null, 2);
  // Write with 0600 permissions — the file contains the credentials file path,
  // so limit visibility to the current user only.
  writeFileSync(configPath, jsonStr, { mode: 0o600 });

  // Post-write validation: verify the file was actually written and is readable.
  // This catches race conditions where cleanup deletes the file between write and
  // Claude Code reading it.
  if (!existsSync(configPath)) {
    console.error(`[mcp-config] CRITICAL: config file not found after write: ${configPath}`);
    // Retry write once
    writeFileSync(configPath, jsonStr, { mode: 0o600 });
    if (!existsSync(configPath)) {
      console.error("[mcp-config] retry also failed — MCP servers will be unavailable");
      return null;
    }
  }

  // Verify content is valid JSON and contains expected servers
  try {
    const readBack = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(readBack);
    const serverNames = Object.keys(parsed.mcpServers ?? {});
    console.error(`[mcp-config] verified config for run ${runId}: ${serverNames.join(", ")}`);
  } catch (err) {
    console.error(`[mcp-config] WARNING: config file validation failed: ${err}`);
  }

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
 *
 * Only deletes files older than 5 minutes to avoid a race condition where
 * a config written for a new run gets deleted before Claude Code reads it.
 */
export function cleanupOrphanedConfigs(): void {
  const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
  const now = Date.now();
  let cleaned = 0;

  try {
    const files = readdirSync(MCP_CONFIG_DIR);
    for (const file of files) {
      if (file.startsWith("run-") && file.endsWith(".json")) {
        const filePath = join(MCP_CONFIG_DIR, file);
        try {
          const stat = statSync(filePath);
          const age = now - stat.mtimeMs;
          if (age > MAX_AGE_MS) {
            unlinkSync(filePath);
            cleaned++;
          }
        } catch {
          // File already gone or can't be stat'd — ignore
        }
      }
    }
    if (cleaned > 0) {
      console.error(`[mcp-config] cleaned up ${cleaned} orphaned config file(s)`);
    }
  } catch {
    // Directory doesn't exist yet — nothing to clean
  }
}

/**
 * Reads the Claude Code user config to extract configured MCP server names.
 * Used to inject MCP context into chat system prompts.
 *
 * Also exports a one-time migration that normalises legacy MCP server keys
 * (dash form `openhelm-browser` → underscore form `openhelm_browser`) so the
 * user's global config agrees with the bundled per-run config. When both
 * forms coexist during a job run, Claude calls the dash variant which is
 * loaded without --credentials-file/--run-id, leading to
 * "No browser credential named 'X (Twitter)' is available" errors.
 * See docs/browser/efficiency-improvements.md Round 12.
 */

import { readFileSync, writeFileSync, renameSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

/**
 * Returns the list of MCP server names configured in ~/.claude.json.
 * Returns an empty array if the file is missing or unreadable.
 */
export function getConfiguredMcpServers(): string[] {
  try {
    const configPath = join(homedir(), ".claude.json");
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    return Object.keys(config.mcpServers ?? {});
  } catch {
    return [];
  }
}

/**
 * Migrates a stale ``openhelm-browser`` (dash) MCP server entry in
 * ``~/.claude.json`` to the canonical ``openhelm_browser`` (underscore) key.
 *
 * Background: older installs registered the global browser MCP under the
 * dash form. The bundled per-run config always uses the underscore form. When
 * both exist, Claude Code merges them additively and both processes are
 * spawned — but Claude sometimes calls ``mcp__openhelm-browser__*`` (the
 * global, credential-less variant), which has ``available_credentials: []``
 * and breaks any task that needs ``auto_login``. Normalising the key
 * eliminates the dash variant entirely.
 *
 * This is safe to call on every agent startup — it is a no-op after the
 * first run. When both keys coexist (very rare, transitional), the bundled
 * underscore key wins (it already has the correct value) and the dash one
 * is dropped.
 *
 * Returns a short status string used for startup logging.
 */
export function migrateLegacyBrowserMcpKey(): "migrated" | "noop" | "error" {
  const configPath = join(homedir(), ".claude.json");
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch {
    return "noop"; // no global config, nothing to migrate
  }
  let config: { mcpServers?: Record<string, unknown> };
  try {
    config = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
  } catch {
    return "error";
  }
  const servers = config.mcpServers;
  if (!servers || typeof servers !== "object") return "noop";
  if (!("openhelm-browser" in servers)) return "noop";

  const dashEntry = servers["openhelm-browser"];
  delete servers["openhelm-browser"];
  // Underscore entry wins if it already exists (never overwrite the
  // canonical one). Otherwise promote the dash entry to the new key.
  if (!("openhelm_browser" in servers)) {
    servers["openhelm_browser"] = dashEntry;
  }
  // Atomic write: temp file + rename. ~/.claude.json is hot (Claude Code
  // rewrites it on every prompt submission) and a non-atomic write risks
  // a torn read.
  try {
    const tmpPath = join(
      tmpdir(),
      `claude.json.openhelm-${process.pid}-${Date.now()}.tmp`,
    );
    writeFileSync(tmpPath, JSON.stringify(config, null, 2));
    renameSync(tmpPath, configPath);
    return "migrated";
  } catch {
    return "error";
  }
}

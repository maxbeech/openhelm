/**
 * Reads the Claude Code user config to extract configured MCP server names.
 * Used to inject MCP context into chat system prompts.
 */

import { readFileSync } from "fs";
import { homedir } from "os";
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

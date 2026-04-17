/**
 * Shared MCP context builder for a single agent run.
 *
 * Produces the --mcp-config path, the prompt prefix (browser + data-table
 * preambles) and the appendSystemPrompt string that both the scheduled-job
 * executor and the full-access chat agentic runner pass into the backend.
 *
 * Extracted from agent/src/executor/index.ts so chat and executor share one
 * implementation — keep them in lockstep by editing this file only.
 */

export interface McpRunContext {
  mcpConfigPath?: string;
  appendSystemPrompt?: string;
  promptPrefix: string;
  hasBrowserMcp: boolean;
  /**
   * Server names configured for this run. Used by the tool-missing detector
   * to filter phantom server names (Round 10 / Pattern 14 — Dream 100
   * Discovery was marked failed because Claude hallucinated
   * `mcp__WebSearch__*` calls against a server that doesn't exist).
   */
  configuredMcpServers: string[];
}

export interface BuildRunMcpContextOptions {
  runId: string;
  projectId: string;
  browserCredentialsFilePath?: string;
  /**
   * Browser credentials resolved for this run. When provided, the preamble
   * includes a per-credential "pre-loaded" notice via
   * `buildBrowserCredentialsNotice` — prevents Claude from hallucinating
   * credential names. Optional: chat mode passes undefined.
   */
  resolvedBrowserCredentials?: Array<{
    name: string;
    type: "username_password" | "token";
    profileName?: string;
  }>;
  /**
   * User-configured MCP connections resolved for this run.
   * Each entry's config.installCommand is used to construct a McpServerEntry.
   * Bundled servers (openhelm_browser, openhelm_data) always win on name collision.
   */
  resolvedMcpConnections?: Array<{
    id: string;
    name: string;
    config: { installCommand?: string[]; serverUrl?: string; transport?: string };
  }>;
}

/**
 * Build the MCP context for a run. Non-fatal on any error — returns an empty
 * context (empty promptPrefix, no mcpConfigPath) so callers can degrade
 * gracefully to a tool-less run.
 */
export async function buildRunMcpContext(
  opts: BuildRunMcpContextOptions,
): Promise<McpRunContext> {
  const { runId, projectId, browserCredentialsFilePath, resolvedBrowserCredentials, resolvedMcpConnections } = opts;

  // Build user McpServerEntry map from resolved MCP connections (stdio/npx/uvx only)
  let userMcpServers: Record<string, import("./mcp-config-builder.js").McpServerEntry> | undefined;
  if (resolvedMcpConnections && resolvedMcpConnections.length > 0) {
    userMcpServers = {};
    for (const conn of resolvedMcpConnections) {
      const cmd = conn.config.installCommand;
      if (!cmd || cmd.length === 0) continue;
      const [command, ...args] = cmd;
      // Sanitize name to a valid MCP server key
      const key = conn.name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
      userMcpServers[key] = { command, args };
    }
  }

  // ── Ensure the browser MCP venv is ready (auto-setup on first run) ──
  let hasBrowserMcp = false;
  try {
    const { isVenvReady, isSourceAvailable, setupBrowserMcpVenv } =
      await import("./browser-setup.js");
    if (isVenvReady()) {
      hasBrowserMcp = true;
    } else if (isSourceAvailable()) {
      console.error("[mcp-context] browser MCP source available but venv not ready — setting up...");
      try {
        await setupBrowserMcpVenv();
        hasBrowserMcp = true;
        console.error("[mcp-context] browser MCP venv setup complete");
      } catch (setupErr) {
        console.error("[mcp-context] browser MCP auto-setup failed (non-fatal):", setupErr);
      }
    }
  } catch {
    /* browser setup not available — non-fatal */
  }

  // ── Write MCP config file (bundled openhelm_browser + openhelm_data servers) ──
  let mcpConfigPath: string | undefined;
  let configuredMcpServers: string[] = [];
  try {
    const { writeMcpConfigFile } = await import("./mcp-config-builder.js");
    const { existsSync: fsExists } = await import("fs");
    const mcpInfo = writeMcpConfigFile(
      runId,
      hasBrowserMcp ? browserCredentialsFilePath : undefined,
      projectId,
      userMcpServers,
    );
    if (mcpInfo) {
      mcpConfigPath = mcpInfo.path;
      configuredMcpServers = mcpInfo.serverNames;
      // Pre-flight check: verify the config file exists and is readable.
      // Catches race conditions where cleanup or filesystem issues cause
      // "No such tool available" errors that waste entire runs.
      if (fsExists(mcpConfigPath)) {
        console.error(`[mcp-context] MCP config written and verified for run ${runId}`);
      } else {
        console.error(`[mcp-context] WARNING: MCP config file missing after write: ${mcpConfigPath}`);
        mcpConfigPath = undefined;
        configuredMcpServers = [];
      }
    }
  } catch (err) {
    console.error("[mcp-context] MCP config generation error (non-fatal):", err);
  }

  // ── Build prompt prefix + system prompt addition ──
  // EXECUTION_SYSTEM_PROMPT is always appended — it prevents the agent from
  // asking "Should I start?" instead of executing immediately.
  // EXTERNAL_MCP_GUIDANCE codifies third-party MCP server quirks (Notion
  // hyphens/underscores, Sentry OR/AND quirks) so the agent doesn't
  // rediscover them every context compaction.
  let promptPrefix = "";
  let appendSystemPrompt: string | undefined;
  try {
    const { EXECUTION_SYSTEM_PROMPT, EXTERNAL_MCP_GUIDANCE } = await import("./mcp-config-builder.js");
    appendSystemPrompt = EXECUTION_SYSTEM_PROMPT + "\n\n" + EXTERNAL_MCP_GUIDANCE;
  } catch (err) {
    console.error("[mcp-context] EXECUTION_SYSTEM_PROMPT import error (non-fatal):", err);
  }

  if (mcpConfigPath) {
    const {
      BROWSER_MCP_PREAMBLE,
      BROWSER_CAPTCHA_PREAMBLE,
      BROWSER_PROFILE_PREAMBLE,
      SOCIAL_MEDIA_ENGAGEMENT_PREAMBLE,
      DATA_TABLES_MCP_PREAMBLE,
      BROWSER_SYSTEM_PROMPT,
      buildBrowserCredentialsNotice,
    } = await import("./mcp-config-builder.js");

    // Data tables preamble (always available when MCP config exists)
    promptPrefix = DATA_TABLES_MCP_PREAMBLE + promptPrefix;

    // Browser MCP preambles + system prompt (only when venv is ready)
    if (hasBrowserMcp) {
      promptPrefix =
        BROWSER_MCP_PREAMBLE +
        BROWSER_CAPTCHA_PREAMBLE +
        BROWSER_PROFILE_PREAMBLE +
        SOCIAL_MEDIA_ENGAGEMENT_PREAMBLE +
        promptPrefix;
      appendSystemPrompt = (appendSystemPrompt ? appendSystemPrompt + "\n\n" : "") + BROWSER_SYSTEM_PROMPT;
      // Always prepend the credentials notice when we have a resolved set —
      // tells the agent exactly which credentials are loaded (or that none are)
      // and prevents hallucination of credential names.
      if (resolvedBrowserCredentials) {
        promptPrefix = buildBrowserCredentialsNotice(resolvedBrowserCredentials) + promptPrefix;
      }
    }
  }

  return { mcpConfigPath, appendSystemPrompt, promptPrefix, hasBrowserMcp, configuredMcpServers };
}

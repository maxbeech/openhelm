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
  /** Path to the generated MCP config JSON file (undefined if generation failed). */
  mcpConfigPath?: string;
  /** System-level browser instructions, appended via `--append-system-prompt`. */
  appendSystemPrompt?: string;
  /** Text to prepend to the user's prompt (data-tables + browser preambles). */
  promptPrefix: string;
  /** True when the browser MCP venv is ready and its tools are registered. */
  hasBrowserMcp: boolean;
}

export interface BuildRunMcpContextOptions {
  runId: string;
  projectId: string;
  browserCredentialsFilePath?: string;
}

/**
 * Build the MCP context for a run. Non-fatal on any error — returns an empty
 * context (empty promptPrefix, no mcpConfigPath) so callers can degrade
 * gracefully to a tool-less run.
 */
export async function buildRunMcpContext(
  opts: BuildRunMcpContextOptions,
): Promise<McpRunContext> {
  const { runId, projectId, browserCredentialsFilePath } = opts;

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

  // ── Write MCP config file (bundled openhelm-browser + openhelm-data servers) ──
  let mcpConfigPath: string | undefined;
  try {
    const { writeMcpConfigFile } = await import("./mcp-config-builder.js");
    mcpConfigPath =
      writeMcpConfigFile(runId, hasBrowserMcp ? browserCredentialsFilePath : undefined, projectId) ??
      undefined;
    if (mcpConfigPath) {
      console.error(`[mcp-context] MCP config written for run ${runId}`);
    }
  } catch (err) {
    console.error("[mcp-context] MCP config generation error (non-fatal):", err);
  }

  // ── Build prompt prefix + system prompt addition ──
  let promptPrefix = "";
  let appendSystemPrompt: string | undefined;
  if (mcpConfigPath) {
    const {
      BROWSER_MCP_PREAMBLE,
      BROWSER_CAPTCHA_PREAMBLE,
      BROWSER_CREDENTIALS_PREAMBLE,
      BROWSER_PROFILE_PREAMBLE,
      DATA_TABLES_MCP_PREAMBLE,
      BROWSER_SYSTEM_PROMPT,
    } = await import("./mcp-config-builder.js");

    // Data tables preamble (always available when MCP config exists)
    promptPrefix = DATA_TABLES_MCP_PREAMBLE + promptPrefix;

    // Browser MCP preambles + system prompt (only when venv is ready)
    if (hasBrowserMcp) {
      promptPrefix = BROWSER_MCP_PREAMBLE + BROWSER_CAPTCHA_PREAMBLE + BROWSER_PROFILE_PREAMBLE + promptPrefix;
      appendSystemPrompt = BROWSER_SYSTEM_PROMPT;
      if (browserCredentialsFilePath) {
        promptPrefix = BROWSER_CREDENTIALS_PREAMBLE + promptPrefix;
      }
    }
  }

  return { mcpConfigPath, appendSystemPrompt, promptPrefix, hasBrowserMcp };
}

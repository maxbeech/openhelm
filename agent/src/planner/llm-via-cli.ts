/**
 * Adapter that planner modules call instead of the old Anthropic SDK client.
 * Translates planner needs into runClaudeCodePrint calls.
 */

import { runClaudeCodePrint } from "../claude-code/print.js";
import { getSetting } from "../db/queries/settings.js";

export type ModelTier = "planning" | "classification" | "chat";

export interface LlmCallConfig {
  model?: ModelTier;
  /** Override the resolved model string directly (takes precedence over tier) */
  modelOverride?: string;
  /** Effort level passed via --effort flag */
  effort?: "low" | "medium" | "high";
  systemPrompt: string;
  userMessage: string;
  timeoutMs?: number;
  jsonSchema?: object;
  onProgress?: (chunk: string) => void;
  /** Whether to pass --tools "" to disable tool use (default: true) */
  disableTools?: boolean;
  /** Explicit allowed-tools list (passed via --allowed-tools); overrides disableTools when set */
  allowedTools?: string;
  /** Tools to explicitly deny even in permissive modes (passed via --disallowed-tools) */
  disallowedTools?: string;
  /** Working directory for the Claude Code process (defaults to os.tmpdir()) */
  workingDirectory?: string;
  /** Permission mode for Claude Code (e.g. "plan", "bypassPermissions") */
  permissionMode?: string;
  /** Fired with each text chunk as it streams (enables stream-json output) */
  onTextChunk?: (text: string) => void;
  /** Fired when a tool is invoked by name (enables stream-json output) */
  onToolUse?: (toolName: string) => void;
  /** Use raw assistant text blocks instead of result event summary */
  preferRawText?: boolean;
  /** Resume a previous session (avoids CLI cold start in tool loops) */
  resumeSessionId?: string;
  /** When aborted, kills the underlying Claude Code process immediately. */
  abortSignal?: AbortSignal;
}

const MODEL_MAP: Record<ModelTier, string> = {
  planning: "sonnet",
  classification: "claude-haiku-4-5-20251001",
  chat: "claude-haiku-4-5-20251001",
};

// Tier-specific timeouts: sonnet is slower than haiku, allow generous headroom.
const TIMEOUT_MAP: Record<ModelTier, number> = {
  planning: 180_000,      // 3 minutes — sonnet plan generation can take 60-90s
  classification: 60_000, // 1 minute — haiku assess/summarise is fast but allow headroom
  chat: 300_000,          // 5 minutes — native tool use (web search, file read) takes longer
};

/**
 * Call the LLM via the Claude Code CLI in --print mode.
 * All internal LLM calls (planning, assessment, summarisation) route through here.
 */
export interface LlmCallResult {
  text: string;
  sessionId: string | null;
}

export async function callLlmViaCli(config: LlmCallConfig): Promise<LlmCallResult> {
  const binaryPath = getClaudeCodePath();

  const tier = config.model ?? "planning";
  const model = config.modelOverride ?? MODEL_MAP[tier];
  const timeoutMs = config.timeoutMs ?? TIMEOUT_MAP[tier];

  console.error(`[llm] calling ${model} (tier=${tier}, timeout=${timeoutMs}ms)`);
  const t0 = Date.now();

  const result = await runClaudeCodePrint({
    binaryPath,
    prompt: config.userMessage,
    systemPrompt: config.systemPrompt,
    model,
    disableTools: config.allowedTools ? false : (config.disableTools ?? true),
    allowedTools: config.allowedTools,
    disallowedTools: config.disallowedTools,
    workingDirectory: config.workingDirectory,
    permissionMode: config.permissionMode,
    timeoutMs,
    jsonSchema: config.jsonSchema,
    effort: config.effort,
    onProgress: config.onProgress,
    onTextChunk: config.onTextChunk,
    onToolUse: config.onToolUse,
    preferRawText: config.preferRawText,
    resumeSessionId: config.resumeSessionId,
    abortSignal: config.abortSignal,
  });

  console.error(`[llm] ${model} completed in ${Date.now() - t0}ms (${result.text.length} chars)`);
  return { text: result.text, sessionId: result.sessionId };
}

function getClaudeCodePath(): string {
  const setting = getSetting("claude_code_path");
  if (!setting?.value) {
    throw new Error(
      "Claude Code CLI not configured. Complete setup in Settings.",
    );
  }
  return setting.value;
}

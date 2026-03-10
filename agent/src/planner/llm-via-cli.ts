/**
 * Adapter that planner modules call instead of the old Anthropic SDK client.
 * Translates planner needs into runClaudeCodePrint calls.
 */

import { runClaudeCodePrint } from "../claude-code/print.js";
import { getSetting } from "../db/queries/settings.js";

export type ModelTier = "planning" | "classification" | "chat";

export interface LlmCallConfig {
  model?: ModelTier;
  systemPrompt: string;
  userMessage: string;
  timeoutMs?: number;
  jsonSchema?: object;
  onProgress?: (chunk: string) => void;
}

const MODEL_MAP: Record<ModelTier, string> = {
  planning: "sonnet",
  classification: "claude-haiku-4-5-20251001",
  chat: "sonnet",
};

// Tier-specific timeouts: sonnet is slower than haiku, allow generous headroom.
const TIMEOUT_MAP: Record<ModelTier, number> = {
  planning: 180_000,      // 3 minutes — sonnet plan generation can take 60-90s
  classification: 60_000, // 1 minute — haiku assess/summarise is fast but allow headroom
  chat: 120_000,          // 2 minutes — sonnet for interactive chat (needs structured output)
};

/**
 * Call the LLM via the Claude Code CLI in --print mode.
 * All internal LLM calls (planning, assessment, summarisation) route through here.
 */
export async function callLlmViaCli(config: LlmCallConfig): Promise<string> {
  const binaryPath = getClaudeCodePath();

  const tier = config.model ?? "planning";
  const model = MODEL_MAP[tier];
  const timeoutMs = config.timeoutMs ?? TIMEOUT_MAP[tier];

  console.error(`[llm] calling ${model} (tier=${tier}, timeout=${timeoutMs}ms)`);
  const t0 = Date.now();

  const result = await runClaudeCodePrint({
    binaryPath,
    prompt: config.userMessage,
    systemPrompt: config.systemPrompt,
    model,
    disableTools: true,
    timeoutMs,
    jsonSchema: config.jsonSchema,
    onProgress: config.onProgress,
  });

  console.error(`[llm] ${model} completed in ${Date.now() - t0}ms (${result.text.length} chars)`);
  return result.text;
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

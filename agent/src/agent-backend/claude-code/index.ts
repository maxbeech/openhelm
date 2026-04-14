/**
 * ClaudeCodeBackend — AgentBackend implementation that wraps the existing
 * agent/src/claude-code/ modules. This is the backend used in Community and
 * Business tiers (local mode, Claude Code CLI subscription required).
 *
 * Key constraint: this class composes the claude-code/ modules — it does not
 * duplicate or replace any logic. External callers use this class via the
 * AgentBackend interface and never import from claude-code/ directly.
 */

import { getSetting } from "../../db/queries/settings.js";
import { runClaudeCode } from "../../claude-code/runner.js";
import { runClaudeCodePrint, PrintError } from "../../claude-code/print.js";
import {
  detectClaudeCode,
  checkClaudeCodeHealth,
  MIN_CLI_VERSION,
} from "../../claude-code/detector.js";
import type { InteractiveDetectionType } from "../../claude-code/interactive-detector.js";
import type {
  AgentBackend,
  AgentRunConfig,
  AgentRunResult,
  AgentEvent,
  LlmCallConfig,
  LlmCallResult,
  BackendInfo,
  McpServerConfig,
  SystemEventData,
} from "../types.js";

/** Default Claude Code CLI model aliases (short-form accepted by the claude binary). */
const MODEL_MAP: Record<string, string> = {
  planning: "sonnet",
  classification: "claude-haiku-4-5-20251001",
  chat: "claude-haiku-4-5-20251001",
  execution: "sonnet",
};

export class ClaudeCodeBackend implements AgentBackend {
  readonly name = "claude-code";

  async detect(): Promise<BackendInfo | null> {
    const result = await detectClaudeCode();
    if (!result.found || !result.path || !result.version) return null;
    const health = await checkClaudeCodeHealth();
    return {
      name: "claude-code",
      version: result.version,
      path: result.path,
      healthy: health.healthy,
      authenticated: health.authenticated,
    };
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    const result = await checkClaudeCodeHealth();
    return { ok: result.healthy, error: result.error };
  }

  async run(config: AgentRunConfig): Promise<AgentRunResult> {
    const binaryPath = getBinaryPath();

    const result = await runClaudeCode(
      {
        binaryPath,
        workingDirectory: config.workingDirectory,
        prompt: config.prompt,
        model: config.model,
        modelEffort: config.effort,
        permissionMode: config.permissionMode as "default" | "acceptEdits" | "dontAsk" | "bypassPermissions" | undefined,
        maxBudgetUsd: config.maxBudgetUsd,
        appendSystemPrompt: config.appendSystemPrompt,
        mcpConfigPath: config.mcpConfigPath,
        resumeSessionId: config.resumeSessionId,
        additionalEnv: config.environmentVars,
        timeoutMs: config.timeoutMs,
        silenceTimeoutMs: config.silenceTimeoutMs,

        onPidAvailable: (pid) => {
          const event: AgentEvent = {
            type: "system",
            data: { kind: "pid", pid } satisfies SystemEventData,
          };
          config.onEvent?.(event);
        },

        onLogChunk: (stream, text) => {
          if (stream === "stdout") {
            config.onStdout?.(text);
          } else {
            config.onStderr?.(text);
          }
        },

        // Pure assistant prose — excludes [Tool: …] markers and tool results
        // that onLogChunk("stdout", …) contains. Surfaced as an `assistant`
        // AgentEvent so chat UIs see clean text (not raw tool invocations).
        // Matches the GooseBackend contract for `onEvent(type:"assistant")`.
        onAssistantText: (text) => {
          config.onEvent?.({
            type: "assistant",
            data: { text },
            text,
          });
        },

        onInteractiveDetected: (reason, type: InteractiveDetectionType) => {
          const event: AgentEvent = {
            type: "system",
            data: { kind: "interactive_detected", reason, detectionType: type } satisfies SystemEventData,
          };
          config.onEvent?.(event);
        },

        onNaturalCompletion: (reason) => {
          // Emit as an stderr line so the run viewer shows a trail that matches
          // the old behaviour before the unified-onEvent refactor.
          config.onStderr?.(`[natural completion] ${reason}\n`);
        },
      },
      config.abortSignal,
    );

    return {
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      killed: result.killed,
      sessionId: result.sessionId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      rateLimitUtilization: null, // not available from Claude Code CLI stream-json
      naturalCompletion: result.naturalCompletion,
      toolStats: result.toolStats,
    };
  }

  async kill(_sessionId: string): Promise<void> {
    // In local mode, process cancellation is handled via the AbortSignal
    // passed in AgentRunConfig.abortSignal. Session-level kill is not
    // supported by the Claude Code CLI.
    console.error("[claude-code-backend] kill() called — cancellation is handled via AbortSignal in local mode");
  }

  async llmCall(config: LlmCallConfig): Promise<LlmCallResult> {
    const binaryPath = getBinaryPath();

    const result = await runClaudeCodePrint({
      binaryPath,
      prompt: config.userMessage,
      systemPrompt: config.systemPrompt,
      model: config.model,
      disableTools: config.allowedTools ? false : (config.disableTools ?? true),
      allowedTools: config.allowedTools,
      disallowedTools: config.disallowedTools,
      workingDirectory: config.workingDirectory,
      permissionMode: config.permissionMode,
      timeoutMs: config.timeoutMs,
      jsonSchema: config.jsonSchema,
      effort: config.effort,
      onProgress: config.onProgress,
      onTextChunk: config.onTextChunk,
      onToolUse: config.onToolUse,
      preferRawText: config.preferRawText,
      resumeSessionId: config.resumeSessionId,
      abortSignal: config.abortSignal,
    });

    return {
      text: result.text,
      sessionId: result.sessionId,
    };
  }

  buildMcpConfig(_servers: McpServerConfig[]): unknown {
    // MCP config building is handled externally by mcp-config-builder.ts
    // in the executor layer. This method is a no-op for the ClaudeCode backend
    // in Phase 1 — GooseBackend will use it in Phase 2.
    return null;
  }

  resolveModel(tier: "planning" | "classification" | "chat" | "execution"): string {
    // Allow model overrides via DB settings (e.g. to pin a specific Claude version).
    const settingKey = (tier === "planning" || tier === "execution")
      ? "claude_model_planning"
      : "claude_model_classification";
    const override = getSetting(settingKey)?.value;
    return override ?? MODEL_MAP[tier] ?? MODEL_MAP.execution;
  }
}

/** Read the Claude Code binary path from settings, throwing if not configured. */
function getBinaryPath(): string {
  const setting = getSetting("claude_code_path");
  if (!setting?.value) {
    throw new Error(
      `Claude Code CLI not configured. Complete setup in Settings.\n` +
      `Minimum supported version: ${MIN_CLI_VERSION}`,
    );
  }
  return setting.value;
}

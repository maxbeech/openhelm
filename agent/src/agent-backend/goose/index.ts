/**
 * GooseBackend — AgentBackend implementation for Goose (block/goose).
 *
 * Used by the Cloud tier. Spawns `goose run` with --output-format stream-json
 * and maps Goose's event stream to the common AgentEvent interface.
 *
 * Key differences from ClaudeCodeBackend:
 *  - Prompt delivered via stdin using `-i -` (not as a positional arg)
 *  - Model configured via GOOSE_PROVIDER / GOOSE_MODEL env vars or --provider/--model flags
 *  - No session ID in Goose output; sessionId in results is always null
 *  - Token count comes from the "complete" event's total_tokens field
 *  - Health check spawns a minimal goose run (no API key needed for detect(), only for healthCheck())
 */

import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import {
  detectGoose,
  checkGooseHealth,
  MIN_GOOSE_VERSION,
} from "./detector.js";
import { parseGooseStreamLine } from "./stream-parser.js";
import type {
  AgentBackend,
  AgentRunConfig,
  AgentRunResult,
  AgentEvent,
  LlmCallConfig,
  LlmCallResult,
  BackendInfo,
  McpServerConfig,
} from "../types.js";
import type { SettingKey } from "@openhelm/shared";

const SIGKILL_DELAY_MS = 5000;
const DEFAULT_SILENCE_TIMEOUT_MS = 600_000; // 10 minutes

// ─── Provider & model defaults ─────────────────────────────────────────────────

/**
 * Default model IDs per provider tier.
 * When switching providers, supply model overrides via GooseBackendConfig.models
 * or the goose_model_* DB settings to use the appropriate model IDs for that provider.
 */
const PROVIDER_DEFAULT_MODELS: Record<string, Record<string, string>> = {
  anthropic: {
    planning: "claude-sonnet-4-6",
    classification: "claude-haiku-4-5-20251001",
    chat: "claude-haiku-4-5-20251001",
    execution: "claude-sonnet-4-6",
  },
  openai: {
    planning: "gpt-4o",
    classification: "gpt-4o-mini",
    chat: "gpt-4o-mini",
    execution: "gpt-4o",
  },
  openrouter: {
    // OpenRouter model IDs use "provider/model" format; default to Claude equivalents.
    // Override via goose_model_* settings or GooseBackendConfig.models for other models.
    planning: "anthropic/claude-sonnet-4-6",
    classification: "anthropic/claude-haiku-4-5-20251001",
    chat: "anthropic/claude-haiku-4-5-20251001",
    execution: "anthropic/claude-sonnet-4-6",
  },
};

/** Environment variable name to inject API key for each provider */
const PROVIDER_API_KEY_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

/**
 * Optional constructor config for GooseBackend.
 * Used by the Worker Service (cloud mode) to inject provider config explicitly
 * rather than reading from the local SQLite DB.
 */
export interface GooseBackendConfig {
  /** LLM provider for Goose (e.g. "anthropic", "openai", "openrouter"). Defaults to DB setting or "anthropic". */
  provider?: string;
  /** API key for the configured provider. If omitted, the provider's standard env var must already be set. */
  apiKey?: string;
  /** Model ID overrides per tier. Takes precedence over DB settings and provider defaults. */
  models?: Partial<Record<"planning" | "classification" | "chat" | "execution", string>>;
}

/**
 * Read a setting from the local SQLite DB without throwing.
 * Returns null if the DB is unavailable (e.g. in Worker or test contexts).
 */
function tryReadSetting(key: SettingKey): string | null {
  try {
    // Dynamic import avoids hard dependency on DB layer in Worker/cloud contexts.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getSetting } = require("../../db/queries/settings.js") as typeof import("../../db/queries/settings.js");
    return getSetting(key)?.value ?? null;
  } catch {
    return null;
  }
}

export class GooseBackend implements AgentBackend {
  readonly name = "goose";

  private _binaryPath: string | null = null;
  private _version: string | null = null;
  private readonly _cfg: GooseBackendConfig;

  constructor(config: GooseBackendConfig = {}) {
    this._cfg = config;
  }

  async detect(): Promise<BackendInfo | null> {
    const detected = await detectGoose();
    if (!detected) return null;
    this._binaryPath = detected.path;
    this._version = detected.version;
    return {
      name: "goose",
      version: detected.version,
      path: detected.path,
      healthy: true,
      authenticated: false, // health check is separate
    };
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    const path = await this._requireBinaryPath();
    const result = await checkGooseHealth(path);
    return { ok: result.healthy, error: result.error };
  }

  async run(config: AgentRunConfig): Promise<AgentRunResult> {
    const binaryPath = await this._requireBinaryPath();
    const args = buildRunArgs(config);

    console.error(`[goose-backend] spawning: ${binaryPath} (${args.length} args, prompt ${config.prompt.length} chars)`);
    console.error(`[goose-backend] cwd: ${config.workingDirectory}`);

    return new Promise((resolve) => {
      const env = buildEnv(config, this._resolveProvider(), this._cfg.apiKey, this._resolveModelMap());

      const child = spawn(binaryPath, args, {
        cwd: config.workingDirectory,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      if (child.pid !== undefined) {
        const pidEvent: AgentEvent = { type: "system", data: { kind: "pid", pid: child.pid } };
        config.onEvent?.(pidEvent);
      }

      let timedOut = false;
      let killed = false;
      let resolved = false;
      let capturedTotalTokens: number | null = null;

      // Silence detection (reuse same approach as ClaudeCodeBackend)
      let lastActivityAt = Date.now();
      const silenceTimeoutMs = config.silenceTimeoutMs ?? DEFAULT_SILENCE_TIMEOUT_MS;
      const silenceTimer = setInterval(() => {
        if (Date.now() - lastActivityAt > silenceTimeoutMs) {
          console.error(`[goose-backend] silence timeout after ${silenceTimeoutMs}ms`);
          timedOut = true;
          killProcess(child);
        }
      }, 10_000);

      const finish = (exitCode: number | null) => {
        if (resolved) return;
        resolved = true;
        clearInterval(silenceTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (abortHandler) config.abortSignal?.removeEventListener("abort", abortHandler);
        resolve({
          exitCode,
          timedOut,
          killed,
          sessionId: null, // Goose doesn't expose session IDs
          inputTokens: null,
          outputTokens: capturedTotalTokens,
          rateLimitUtilization: null,
        });
      };

      // stdout: parse stream-json lines
      const stdoutRl = createInterface({ input: child.stdout! });
      stdoutRl.on("line", (line) => {
        lastActivityAt = Date.now();
        config.onStdout?.(line);

        const parsed = parseGooseStreamLine(line);
        if (!parsed) return;

        if (parsed.isComplete) {
          if (parsed.totalTokens != null) capturedTotalTokens = parsed.totalTokens;
          const event: AgentEvent = {
            type: "result",
            data: { total_tokens: parsed.totalTokens },
            outputTokens: parsed.totalTokens ?? undefined,
          };
          config.onEvent?.(event);
          return;
        }

        if (parsed.text) {
          const event: AgentEvent = {
            type: parsed.toolName ? "tool_use" : "assistant",
            data: { text: parsed.text },
            text: parsed.text,
            toolName: parsed.toolName,
          };
          config.onEvent?.(event);
        }
      });

      // stderr: raw lines
      const stderrRl = createInterface({ input: child.stderr! });
      stderrRl.on("line", (line) => {
        lastActivityAt = Date.now();
        config.onStderr?.(line);
      });

      // Write prompt via stdin (avoids ARG_MAX, matches runner.ts approach)
      child.stdin?.on("error", (err) => {
        console.error("[goose-backend] stdin write error:", err.message);
      });
      child.stdin?.write(config.prompt);
      child.stdin?.end();

      // Wall-clock timeout (if configured)
      const timeoutTimer = config.timeoutMs && config.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            console.error(`[goose-backend] wall-clock timeout after ${config.timeoutMs}ms`);
            killProcess(child);
          }, config.timeoutMs)
        : null;

      // Cancellation via AbortSignal
      let abortHandler: (() => void) | null = null;
      if (config.abortSignal) {
        abortHandler = () => {
          killed = true;
          console.error("[goose-backend] run cancelled via AbortSignal");
          killProcess(child);
        };
        config.abortSignal.addEventListener("abort", abortHandler, { once: true });
      }

      child.on("close", (code) => {
        console.error(`[goose-backend] process exited with code ${code}`);
        finish(code);
      });

      child.on("error", (err) => {
        console.error(`[goose-backend] process error: ${err.message}`);
        config.onStderr?.(`Process error: ${err.message}`);
        finish(null);
      });
    });
  }

  async kill(_sessionId: string): Promise<void> {
    // In cloud mode the caller uses AbortSignal. Session-level kill is not
    // supported — log and return.
    console.error("[goose-backend] kill() called — use AbortSignal for cancellation");
  }

  async llmCall(config: LlmCallConfig): Promise<LlmCallResult> {
    const binaryPath = await this._requireBinaryPath();

    // Build args for a single-turn text completion via goose run
    const args: string[] = [
      "run",
      "--output-format", "stream-json",
      "--no-session",
      "-i", "-", // read prompt from stdin
    ];

    // Model selection
    const model = config.model;
    if (model) args.push("--model", model);

    // Disable tools for pure text calls (no --with-extension flags added)
    // When disableTools is false, callers pass allowedTools — not currently
    // supported in Goose CLI without extension flags.
    if (config.disableTools !== false) {
      // No extension flags → no tools available
    }

    const env = buildBaseEnv(config.model, this._resolveProvider(), this._cfg.apiKey, this._resolveModelMap());

    // Build the full prompt (system + user)
    const fullPrompt = config.systemPrompt
      ? `${config.systemPrompt}\n\n${config.userMessage}`
      : config.userMessage;

    return new Promise((resolve, reject) => {
      const child = spawn(binaryPath, args, {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const textParts: string[] = [];
      let timedOut = false;

      const stdoutRl = createInterface({ input: child.stdout! });
      stdoutRl.on("line", (line) => {
        const parsed = parseGooseStreamLine(line);
        if (!parsed) return;
        if (parsed.isComplete) return;
        if (parsed.text) {
          textParts.push(parsed.text);
          config.onTextChunk?.(parsed.text);
          config.onProgress?.(parsed.text);
        }
        if (parsed.toolName) config.onToolUse?.(parsed.toolName);
      });

      child.stdin?.on("error", (err) => {
        console.error("[goose-backend] llmCall stdin error:", err.message);
      });
      child.stdin?.write(fullPrompt);
      child.stdin?.end();

      const timeoutMs = config.timeoutMs ?? 180_000;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);

      let abortHandler: (() => void) | null = null;
      if (config.abortSignal) {
        abortHandler = () => {
          child.kill("SIGTERM");
        };
        config.abortSignal.addEventListener("abort", abortHandler, { once: true });
      }

      child.on("close", (code) => {
        clearTimeout(timer);
        if (abortHandler) config.abortSignal?.removeEventListener("abort", abortHandler);
        if (timedOut) {
          reject(new Error(`Goose llmCall timed out after ${timeoutMs}ms`));
          return;
        }
        const text = textParts.join("\n").trim();
        if (!text && code !== 0) {
          reject(new Error(`Goose llmCall failed with exit code ${code}`));
          return;
        }
        resolve({ text, sessionId: null });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`Goose llmCall spawn error: ${err.message}`));
      });
    });
  }

  buildMcpConfig(servers: McpServerConfig[]): unknown {
    // Goose uses --with-extension flags, not a config file.
    // Return the servers list so the caller can build the flags array.
    return { servers };
  }

  /**
   * Build the `--with-extension` flag strings for a list of MCP server configs.
   * Each stdio server becomes: "<command> <args...>"
   */
  buildExtensionFlags(servers: McpServerConfig[]): string[] {
    const flags: string[] = [];
    for (const server of servers) {
      const cmdParts = [server.command, ...(server.args ?? [])].join(" ");
      flags.push("--with-extension", cmdParts);
    }
    return flags;
  }

  resolveModel(tier: "planning" | "classification" | "chat" | "execution"): string {
    return this._resolveModelMap()[tier] ?? PROVIDER_DEFAULT_MODELS.anthropic.execution;
  }

  /** Resolve the active provider: constructor > DB setting > "anthropic" */
  private _resolveProvider(): string {
    return this._cfg.provider
      ?? tryReadSetting("goose_provider")
      ?? "anthropic";
  }

  /**
   * Build the resolved model map for the active provider.
   * Priority: constructor config > DB settings > provider defaults.
   */
  private _resolveModelMap(): Record<string, string> {
    const provider = this._resolveProvider();
    const providerDefaults = PROVIDER_DEFAULT_MODELS[provider] ?? PROVIDER_DEFAULT_MODELS.anthropic;
    return {
      planning: this._cfg.models?.planning ?? tryReadSetting("goose_model_planning") ?? providerDefaults.planning,
      classification: this._cfg.models?.classification ?? tryReadSetting("goose_model_classification") ?? providerDefaults.classification,
      chat: this._cfg.models?.chat ?? tryReadSetting("goose_model_chat") ?? providerDefaults.chat,
      execution: this._cfg.models?.execution ?? tryReadSetting("goose_model_execution") ?? providerDefaults.execution,
    };
  }

  private async _requireBinaryPath(): Promise<string> {
    if (this._binaryPath) return this._binaryPath;
    const detected = await detectGoose();
    if (!detected) {
      throw new Error(
        `Goose binary not found. Install from https://github.com/block/goose.\n` +
        `Minimum supported version: ${MIN_GOOSE_VERSION}`,
      );
    }
    this._binaryPath = detected.path;
    this._version = detected.version;
    return this._binaryPath;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build CLI args for a goose run invocation */
function buildRunArgs(config: AgentRunConfig): string[] {
  const args: string[] = [
    "run",
    "--output-format", "stream-json",
    "--no-session",
    "-i", "-", // read prompt from stdin
  ];

  if (config.model) args.push("--model", config.model);

  if (config.mcpConfigPath) {
    args.push("--mcp-config", config.mcpConfigPath);
  }

  // Goose has no built-in wall-clock timeout flag — enforced via Node.js SIGTERM below.

  return args;
}

/** Build the environment for a goose run invocation */
function buildEnv(
  config: AgentRunConfig,
  provider: string,
  apiKey: string | undefined,
  modelMap: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    GOOSE_PROVIDER: provider,
    GOOSE_MODEL: config.model ?? modelMap.execution,
    ...config.environmentVars,
  };

  // Inject provider-specific API key when explicitly supplied (Cloud mode / BYOK).
  // In local mode the key is expected to already exist in the user's environment.
  if (apiKey) {
    const keyEnvVar = PROVIDER_API_KEY_ENV[provider] ?? `${provider.toUpperCase()}_API_KEY`;
    env[keyEnvVar] = apiKey;
  }

  // Lead/worker model split for multi-turn runs
  if (!env.GOOSE_LEAD_MODEL) {
    env.GOOSE_LEAD_MODEL = modelMap.planning;
    env.GOOSE_LEAD_PROVIDER = provider;
    env.GOOSE_LEAD_TURNS = "3";
  }

  return env;
}

/** Build minimal env for single-turn LLM calls */
function buildBaseEnv(
  model: string | undefined,
  provider: string,
  apiKey: string | undefined,
  modelMap: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    GOOSE_PROVIDER: provider,
    GOOSE_MODEL: model ?? modelMap.classification,
  };

  if (apiKey) {
    const keyEnvVar = PROVIDER_API_KEY_ENV[provider] ?? `${provider.toUpperCase()}_API_KEY`;
    env[keyEnvVar] = apiKey;
  }

  return env;
}

/** Kill a child process gracefully: SIGTERM then SIGKILL */
function killProcess(child: ChildProcess): void {
  if (child.killed) return;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (!child.killed) {
      console.error("[goose-backend] process did not exit after SIGTERM, sending SIGKILL");
      child.kill("SIGKILL");
    }
  }, SIGKILL_DELAY_MS);
}

/**
 * GooseBackend helpers: constants, config types, environment builders, and
 * process management utilities shared between GooseBackend and callers.
 */

import { spawn, type ChildProcess } from "child_process";
import type { AgentRunConfig } from "../types.js";
import type { SettingKey } from "@openhelm/shared";

export const SIGKILL_DELAY_MS = 5000;
export const DEFAULT_SILENCE_TIMEOUT_MS = 600_000; // 10 minutes

// ─── Provider & model defaults ─────────────────────────────────────────────────

/**
 * Default model IDs per provider tier.
 * When switching providers, supply model overrides via GooseBackendConfig.models
 * or the goose_model_* DB settings to use the appropriate model IDs for that provider.
 */
export const PROVIDER_DEFAULT_MODELS: Record<string, Record<string, string>> = {
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
export const PROVIDER_API_KEY_ENV: Record<string, string> = {
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
export function tryReadSetting(key: SettingKey): string | null {
  try {
    // Dynamic import avoids hard dependency on DB layer in Worker/cloud contexts.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getSetting } = require("../../db/queries/settings.js") as typeof import("../../db/queries/settings.js");
    return getSetting(key)?.value ?? null;
  } catch {
    return null;
  }
}

// ─── CLI argument builders ─────────────────────────────────────────────────────

/** Build CLI args for a goose run invocation */
export function buildRunArgs(config: AgentRunConfig): string[] {
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
export function buildEnv(
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
export function buildBaseEnv(
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
export function killProcess(child: ChildProcess): void {
  if (child.killed) return;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (!child.killed) {
      console.error("[goose-backend] process did not exit after SIGTERM, sending SIGKILL");
      child.kill("SIGKILL");
    }
  }, SIGKILL_DELAY_MS);
}

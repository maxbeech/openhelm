/**
 * ClaudeCodeRunner — the ONLY place in the entire codebase that spawns
 * the `claude` process.
 *
 * This is a hard architectural rule. All Claude Code CLI invocations
 * must go through this single module. When Anthropic updates the CLI,
 * this is the only file that changes.
 *
 * The runner:
 * - Spawns Claude Code with -p (print/headless) mode
 * - Uses --output-format stream-json for structured streaming
 * - Streams output to a callback in real time
 * - Manages timeouts with SIGTERM then SIGKILL
 * - Supports cancellation via AbortSignal
 */

import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import type { ClaudeCodeRunResult } from "@openhelm/shared";
import { InteractiveDetector, type InteractiveDetectionType } from "./interactive-detector.js";
import { parseStreamLine } from "./stream-parser.js";

export interface RunnerConfig {
  /** Path to the Claude Code binary */
  binaryPath: string;
  /** Working directory for the Claude Code process */
  workingDirectory: string;
  /** The prompt to send to Claude Code */
  prompt: string;
  /** Timeout in milliseconds (default: 0 = no limit) */
  timeoutMs?: number;
  /** Permission mode for Claude Code (default: "bypassPermissions") */
  permissionMode?: "default" | "acceptEdits" | "dontAsk" | "bypassPermissions";
  /** Maximum USD budget for the run */
  maxBudgetUsd?: number;
  /** Model to use, e.g. "sonnet", "opus", "haiku" */
  model?: string;
  /** Effort level passed via --effort flag (low/medium/high) */
  modelEffort?: "low" | "medium" | "high";
  /** Called for each log chunk (stream, text) */
  onLogChunk: (stream: "stdout" | "stderr", text: string) => void;
  /** Silence timeout in milliseconds (default: 180s) */
  silenceTimeoutMs?: number;
  /** Called when interactive input is detected */
  onInteractiveDetected?: (reason: string, type: InteractiveDetectionType) => void;
  /** Resume a previous session instead of starting fresh */
  resumeSessionId?: string;
  /** Additional environment variables to merge into the spawned process env */
  additionalEnv?: Record<string, string>;
  /** Path to MCP config JSON file (passed via --mcp-config) */
  mcpConfigPath?: string;
  /** Appended to the system prompt (--append-system-prompt) */
  appendSystemPrompt?: string;
  /** Called immediately after the Claude Code process is spawned, with its PID */
  onPidAvailable?: (pid: number) => void;
}

const DEFAULT_TIMEOUT_MS = 0; // No limit (silence timeout catches stuck processes)
const DEFAULT_SILENCE_TIMEOUT_MS = 600_000; // 10 minutes
const SIGKILL_DELAY_MS = 5000; // 5 seconds after SIGTERM

/**
 * Run a Claude Code job. This is the sole entry point for executing
 * Claude Code in the entire codebase.
 *
 * @param config - Run configuration
 * @param signal - Optional AbortSignal for cancellation
 * @returns Promise resolving to the run result
 */
export function runClaudeCode(
  config: RunnerConfig,
  signal?: AbortSignal,
): Promise<ClaudeCodeRunResult> {
  return new Promise((resolve) => {
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Build command arguments
    const args = buildArgs(config);

    console.error(
      `[runner] spawning: ${config.binaryPath} (${args.length} args, prompt ${config.prompt.length} chars)`,
    );
    console.error(`[runner] cwd: ${config.workingDirectory}`);

    // Spawn the process — inherit the parent's full environment,
    // merge any additional env vars (e.g. credentials),
    // but unset CLAUDECODE so jobs aren't blocked by nested session detection.
    const env = { ...process.env, ...config.additionalEnv };
    delete env.CLAUDECODE;

    const child = spawn(config.binaryPath, args, {
      cwd: config.workingDirectory,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Notify caller of the child PID so the focus guard can track this process tree.
    if (child.pid !== undefined) {
      config.onPidAvailable?.(child.pid);
    }

    let timedOut = false;
    let killed = false;
    let resolved = false;
    let capturedSessionId: string | null = null;
    let capturedInputTokens: number | null = null;
    let capturedOutputTokens: number | null = null;
    let capturedRateLimitUtilization: number | null = null;
    const toolStatsMap = new Map<string, { invocations: number; approxOutputTokens: number }>();

    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      interactiveDetector.stop();
      if (abortHandler) signal?.removeEventListener("abort", abortHandler);
    };

    const finish = (exitCode: number | null) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve({
        exitCode,
        timedOut,
        killed,
        sessionId: capturedSessionId,
        inputTokens: capturedInputTokens,
        outputTokens: capturedOutputTokens,
        rateLimitUtilization: capturedRateLimitUtilization,
        toolStats: toolStatsMap.size > 0
          ? Array.from(toolStatsMap.entries()).map(([toolName, s]) => ({
              toolName,
              invocations: s.invocations,
              approxOutputTokens: s.approxOutputTokens,
            }))
          : undefined,
      });
    };

    // -- Interactive Detector --
    const interactiveDetector = new InteractiveDetector({
      silenceTimeoutMs: config.silenceTimeoutMs ?? DEFAULT_SILENCE_TIMEOUT_MS,
      onDetected: (reason, type) => {
        console.error(`[runner] interactive detected (${type}): ${reason}`);
        config.onInteractiveDetected?.(reason, type);
      },
    });
    interactiveDetector.start();

    // -- stdout streaming (stream-json lines) --
    const stdoutRl = createInterface({ input: child.stdout! });
    stdoutRl.on("line", (line) => {
      interactiveDetector.bump();
      const parsed = parseStreamLine(line);
      if (parsed) {
        if (parsed.sessionId) capturedSessionId = parsed.sessionId;
        if (parsed.rateLimitUtilization != null) {
          capturedRateLimitUtilization = parsed.rateLimitUtilization;
        }
        // Input tokens: always overwrite — each assistant event's input_tokens
        // is cumulative (includes all prior context), so the last value is correct.
        if (parsed.inputTokens != null) capturedInputTokens = parsed.inputTokens;
        // Output tokens: accumulate per-turn values from assistant events;
        // if the result event carries a definitive total, use it directly.
        if (parsed.outputTokens != null) {
          if (parsed.isResult) {
            capturedOutputTokens = parsed.outputTokens;
          } else {
            capturedOutputTokens = (capturedOutputTokens ?? 0) + parsed.outputTokens;
          }
        }
        // Accumulate per-tool stats (invocations + approximate output tokens).
        // Turns with no tools are attributed to "__reasoning__".
        if (!parsed.isResult && parsed.toolNames !== undefined && parsed.outputTokens != null) {
          const names = parsed.toolNames.length > 0 ? parsed.toolNames : ["__reasoning__"];
          const outputShare = Math.round(parsed.outputTokens / names.length);
          for (const name of names) {
            const s = toolStatsMap.get(name) ?? { invocations: 0, approxOutputTokens: 0 };
            s.invocations += parsed.toolNames.length > 0 ? 1 : 0;
            s.approxOutputTokens += outputShare;
            toolStatsMap.set(name, s);
          }
        }

        // Skip the result event text — it duplicates content already shown in
        // the assistant turn and is surfaced separately as the run summary.
        // EXCEPTION: error-results (is_error=true) carry the actual failure
        // message ("Prompt is too long", "API Error …") and are NOT present
        // in any assistant turn, so we forward them to stderr so they land in
        // RunLog and drive summary + resume-decision logic downstream.
        if (parsed.text && !parsed.isResult) {
          config.onLogChunk("stdout", parsed.text);
          // Record for silence timeout context (no pattern matching)
          interactiveDetector.processLine(parsed.text);
        } else if (parsed.isResult && parsed.isError && parsed.text) {
          config.onLogChunk("stderr", `Claude Code error: ${parsed.text}`);
        }
      }
    });

    // -- stderr streaming (raw lines) --
    const stderrRl = createInterface({ input: child.stderr! });
    stderrRl.on("line", (line) => {
      interactiveDetector.bump();
      config.onLogChunk("stderr", line);
    });

    // -- Write prompt to stdin (avoids ARG_MAX limits and argument-parsing
    //    ambiguity for long prompts, matching print.ts approach) --
    // Attach an error handler before writing — a synchronous EPIPE (e.g. if
    // Claude Code exits before reading stdin) would otherwise become an
    // unhandled stream error and crash the agent.
    child.stdin?.on("error", (err) => {
      console.error("[runner] stdin write error:", err.message);
    });
    child.stdin?.write(config.prompt);
    child.stdin?.end();

    // -- Timeout (only if timeoutMs > 0; 0 means no limit) --
    const timeoutTimer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          console.error(`[runner] timeout after ${timeoutMs}ms, sending SIGTERM`);
          killProcess(child);
        }, timeoutMs)
      : null;

    // -- Cancellation via AbortSignal --
    let abortHandler: (() => void) | null = null;
    if (signal) {
      abortHandler = () => {
        killed = true;
        console.error("[runner] run cancelled via AbortSignal");
        killProcess(child);
      };
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    // -- Process exit --
    child.on("close", (code) => {
      console.error(`[runner] process exited with code ${code}`);
      finish(code);
    });

    child.on("error", (err) => {
      console.error(`[runner] process error: ${err.message}`);
      config.onLogChunk("stderr", `Process error: ${err.message}`);
      finish(null);
    });
  });
}

/** Build the CLI arguments for a Claude Code invocation */
function buildArgs(config: RunnerConfig): string[] {
  const args: string[] = [
    "--print",
    "--verbose",
    "--output-format",
    "stream-json",
  ];

  // Permission mode (default: auto — allows Claude Code to run without prompts)
  const permissionMode = config.permissionMode ?? "bypassPermissions";
  args.push("--permission-mode", permissionMode);

  // Budget limit
  if (config.maxBudgetUsd !== undefined) {
    args.push("--max-budget-usd", String(config.maxBudgetUsd));
  }

  // Model selection
  if (config.model) {
    args.push("--model", config.model);
  }

  // Effort level
  if (config.modelEffort) {
    args.push("--effort", config.modelEffort);
  }

  // Resume a previous session
  if (config.resumeSessionId) {
    args.push("--resume", config.resumeSessionId);
  }

  // Add bundled MCP servers (openhelm-browser, openhelm-data) via --mcp-config.
  // This ADDS them on top of the user's global (~/.claude.json) and project-level
  // (.mcp.json) servers — Claude Code merges them automatically.
  if (config.mcpConfigPath) {
    args.push("--mcp-config", config.mcpConfigPath);
  }

  // System-level instructions (e.g. browser MCP preference) injected via
  // --append-system-prompt. This is far more authoritative than a user-prompt
  // preamble because it becomes part of the system prompt.
  if (config.appendSystemPrompt) {
    args.push("--append-system-prompt", config.appendSystemPrompt);
  }

  // Prompt is written to stdin (not as a positional arg) to avoid
  // OS ARG_MAX limits and CLI argument-parsing issues with long prompts.

  return args;
}

/**
 * Kill a child process gracefully: SIGTERM first, then SIGKILL after delay.
 */
function killProcess(child: ChildProcess): void {
  if (child.killed) return;

  child.kill("SIGTERM");

  setTimeout(() => {
    if (!child.killed) {
      console.error("[runner] process did not exit after SIGTERM, sending SIGKILL");
      child.kill("SIGKILL");
    }
  }, SIGKILL_DELAY_MS);
}

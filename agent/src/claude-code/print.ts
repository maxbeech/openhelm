/**
 * runClaudeCodePrint — lightweight function for "ask Claude a question via
 * CLI, get text back". Used for planning, assessment, and summarisation.
 *
 * Lives in the claude-code/ directory alongside runner.ts, respecting the
 * rule that this directory is the ONLY place that spawns `claude`.
 */

import { spawn } from "child_process";
import { createInterface } from "readline";
import { tmpdir } from "os";

export interface PrintConfig {
  /** Path to the Claude Code binary */
  binaryPath: string;
  /** The prompt to send */
  prompt: string;
  /** System prompt (passed via --system-prompt) */
  systemPrompt?: string;
  /** Model to use (e.g. "claude-haiku-4-5-20251001", "sonnet") */
  model?: string;
  /** Working directory (defaults to os.tmpdir()) */
  workingDirectory?: string;
  /** Timeout in milliseconds (default: 60_000) */
  timeoutMs?: number;
  /** JSON schema for structured output (enables --json-schema) */
  jsonSchema?: object;
  /** Pass --tools "" to disable tool use (default: true) */
  disableTools?: boolean;
  /** Optional callback fired per stdout line as it arrives */
  onProgress?: (chunk: string) => void;
}

export interface PrintResult {
  text: string;
  exitCode: number | null;
}

export class PrintError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "PrintError";
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Run Claude Code in --print mode for a single-turn completion.
 * Returns the text output on success, throws PrintError on failure.
 */
export function runClaudeCodePrint(config: PrintConfig): Promise<PrintResult> {
  return new Promise((resolve, reject) => {
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const cwd = config.workingDirectory ?? tmpdir();

    const args = buildPrintArgs(config);

    console.error(
      `[print] spawning: ${config.binaryPath} --print --model ${config.model ?? "(default)"} (${args.length} args)`,
    );

    // Remove CLAUDECODE env var so Claude Code doesn't refuse to run
    // when the agent itself is being developed inside a Claude Code session.
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn(config.binaryPath, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let resolved = false;

    const stdoutRl = createInterface({ input: child.stdout! });
    stdoutRl.on("line", (line) => {
      stdoutChunks.push(line);
      config.onProgress?.(line + "\n");
    });

    const stderrRl = createInterface({ input: child.stderr! });
    stderrRl.on("line", (line) => stderrChunks.push(line));

    // Write prompt to stdin instead of passing as positional arg.
    // This avoids argument-parsing ambiguity (e.g. --tools "" consuming the prompt).
    child.stdin?.write(config.prompt);
    child.stdin?.end();

    const timeoutTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill("SIGTERM");
        reject(new PrintError(`Claude Code timed out after ${timeoutMs}ms`, null));
      }
    }, timeoutMs);

    child.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutTimer);

      const text = stdoutChunks.join("\n");

      if (code === 0) {
        resolve({ text, exitCode: code });
      } else {
        const stderr = stderrChunks.join("\n");
        reject(
          new PrintError(
            `Claude Code exited with code ${code}${stderr ? `: ${stderr.slice(0, 500)}` : ""}`,
            code,
          ),
        );
      }
    });

    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutTimer);
      reject(new PrintError(`Failed to spawn Claude Code: ${err.message}`, null));
    });
  });
}

function buildPrintArgs(config: PrintConfig): string[] {
  const args: string[] = ["--print"];

  // Output format
  if (config.jsonSchema) {
    args.push("--output-format", "json");
    args.push("--json-schema", JSON.stringify(config.jsonSchema));
  } else {
    args.push("--output-format", "text");
  }

  // Model
  if (config.model) {
    args.push("--model", config.model);
  }

  // System prompt
  if (config.systemPrompt) {
    args.push("--system-prompt", config.systemPrompt);
  }

  // Disable tools (default: true for pure generation calls)
  if (config.disableTools !== false) {
    args.push("--tools", "");
  }

  // Prevent session state from being saved/loaded so internal LLM calls
  // do not bleed across invocations or load unrelated session history.
  args.push("--no-session-persistence");

  return args;
}

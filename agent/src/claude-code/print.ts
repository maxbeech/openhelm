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
  /** Effort level passed via --effort flag (low/medium/high) */
  effort?: "low" | "medium" | "high";
  /** Optional callback fired per stdout line as it arrives */
  onProgress?: (chunk: string) => void;
  /** Permission mode passed via --permission-mode (e.g. "default", "acceptEdits") */
  permissionMode?: string;
  /**
   * Fired with each text chunk as it streams from the assistant.
   * Switches output to --output-format stream-json automatically.
   */
  onTextChunk?: (text: string) => void;
  /**
   * Fired when the assistant invokes a tool (name provided).
   * Switches output to --output-format stream-json automatically.
   */
  onToolUse?: (toolName: string) => void;
  /**
   * When true, extract text from raw assistant message blocks instead of
   * the result event summary.  Chat mode needs this so that <tool_call>
   * XML blocks survive for parsing by response-parser.ts.
   */
  preferRawText?: boolean;
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
    // Use stream-json for streaming callbacks OR structured JSON output: the
    // result event's "result" field is a prose summary, so we must read the
    // assistant message text blocks directly when jsonSchema is requested.
    const useStreamJson = !!(config.onTextChunk || config.onToolUse || config.jsonSchema);

    const stdoutRl = createInterface({ input: child.stdout! });
    stdoutRl.on("line", (line) => {
      stdoutChunks.push(line);
      config.onProgress?.(line + "\n");
      if (useStreamJson) parseStreamJsonLine(line, config);
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
        // Give the process 5 s to handle SIGTERM gracefully; force-kill if still running.
        setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
        }, 5000);
        reject(new PrintError(`Claude Code timed out after ${timeoutMs}ms`, null));
      }
    }, timeoutMs);

    child.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutTimer);

      let text: string;
      if (useStreamJson) {
        // For jsonSchema calls, the assistant text blocks contain the structured
        // JSON response; the result event's "result" field is just a prose summary.
        text = extractResultFromStreamJson(stdoutChunks, !!config.jsonSchema || !!config.preferRawText);
      } else {
        text = stdoutChunks.join("\n");
      }

      if (code === 0) {
        resolve({ text, exitCode: code });
      } else {
        const stderr = stderrChunks.join("\n");
        console.error(
          `[print] Claude Code exited with code ${code}. ` +
            `stdout=${stdoutChunks.length} lines, stderr=${stderrChunks.length} lines` +
            (stderr
              ? `\n[print] stderr: ${stderr.slice(0, 1000)}`
              : " (stderr empty)"),
        );
        reject(
          new PrintError(
            `Claude Code exited with code ${code}${stderr ? `: ${stderr.slice(0, 500)}` : " (no stderr — the prompt may lack sufficient context)"}`,
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

/** Parse a single stream-json line and fire the appropriate callbacks. */
function parseStreamJsonLine(line: string, config: PrintConfig): void {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  const type = event.type as string;
  if (type !== "assistant") return;

  const message = event.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (!Array.isArray(content)) return;

  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type === "text" && typeof block.text === "string" && block.text) {
      config.onTextChunk?.(block.text);
    } else if (block.type === "tool_use" && typeof block.name === "string") {
      config.onToolUse?.(block.name);
    }
  }
}

/**
 * Extract the final result text from collected stream-json lines.
 * @param preferAssistantText - When true (jsonSchema mode), extract structured
 *   output from the result event or StructuredOutput tool calls, falling back
 *   to assistant text blocks.
 */
function extractResultFromStreamJson(lines: string[], preferAssistantText = false): string {
  // For jsonSchema mode: the CLI returns structured output via a
  // StructuredOutput tool call and/or a `structured_output` field in the
  // result event — NOT as a text block in the assistant message.
  if (preferAssistantText) {
    // 1. Check `structured_output` in the result event (highest priority)
    for (const line of lines) {
      let event: Record<string, unknown>;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type === "result" && event.structured_output != null) {
        return JSON.stringify(event.structured_output);
      }
    }
    // 2. Check for StructuredOutput tool_use blocks in assistant messages
    for (const line of lines) {
      let event: Record<string, unknown>;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type !== "assistant") continue;
      const message = event.message as Record<string, unknown> | undefined;
      const content = message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content as Array<Record<string, unknown>>) {
        if (block.type === "tool_use" && block.name === "StructuredOutput" && block.input != null) {
          return JSON.stringify(block.input);
        }
      }
    }
  } else {
    // Non-jsonSchema: use the result event's prose summary
    for (const line of lines) {
      let event: Record<string, unknown>;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type === "result" && typeof event.result === "string") {
        return event.result;
      }
    }
  }
  // Fallback: concatenate all text blocks from assistant events
  const parts: string[] = [];
  for (const line of lines) {
    let event: Record<string, unknown>;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type !== "assistant") continue;
    const message = event.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
  }
  return parts.join("");
}

function buildPrintArgs(config: PrintConfig): string[] {
  const args: string[] = ["--print"];

  // Output format — stream-json when streaming callbacks or jsonSchema are used.
  // We always use stream-json for jsonSchema: the result event's "result" field
  // is a prose summary, so structured JSON lives in the assistant message text blocks.
  const useStreamJson = !!(config.onTextChunk || config.onToolUse || config.jsonSchema);
  if (useStreamJson) {
    args.push("--output-format", "stream-json");
    args.push("--verbose"); // required by CLI when combining --print with --output-format stream-json
    if (config.jsonSchema) {
      args.push("--json-schema", JSON.stringify(config.jsonSchema));
    }
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

  // Permission mode
  if (config.permissionMode) {
    args.push("--permission-mode", config.permissionMode);
  }

  // Effort level
  if (config.effort) {
    args.push("--effort", config.effort);
  }

  // Prevent session state from being saved/loaded so internal LLM calls
  // do not bleed across invocations or load unrelated session history.
  args.push("--no-session-persistence");

  return args;
}

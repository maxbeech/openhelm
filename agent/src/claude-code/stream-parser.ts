/**
 * Parse Claude Code `--output-format stream-json` output lines.
 * Each line is a JSON object representing a streaming event.
 *
 * This module extracts human-readable text from structured events
 * for display in the log viewer.
 */

/** Content block types from Claude API messages */
interface TextBlock {
  type: "text";
  text: string;
}

interface ToolUseBlock {
  type: "tool_use";
  name: string;
  id: string;
  input: unknown;
}

interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: unknown;
}

type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

/** Parsed log entry extracted from a stream-json line */
export interface ParsedLogEntry {
  text: string;
  isResult: boolean;
  /** True when the result event carried `is_error: true` (e.g. prompt too long, API error). */
  isError?: boolean;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  sessionId?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** API rate-limit utilization (0.0–1.0) from a rate_limit_event */
  rateLimitUtilization?: number;
}

/**
 * Parse a single stream-json line into a human-readable log entry.
 * Returns null if the line has no meaningful content to display.
 */
export function parseStreamLine(line: string): ParsedLogEntry | null {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    // Not valid JSON — return the raw line
    return { text: line, isResult: false };
  }

  const type = event.type as string;

  // Capture session_id from any event that carries it (system init, result, etc.)
  const eventSessionId = event.session_id as string | undefined;

  if (type === "result") {
    const usage = event.usage as Record<string, number> | undefined;
    const isError = event.is_error === true;
    // For error results, prefer the explicit `error` field — it carries the
    // actionable message ("Prompt is too long", "API Error …") rather than
    // the duplicated assistant text. Safely coerce to string: the CLI may
    // emit `error` as a plain string or a structured object.
    let resultText: string;
    if (isError) {
      const errField = event.error;
      const errStr =
        typeof errField === "string" ? errField
        : errField != null ? (
          typeof (errField as Record<string, unknown>).message === "string"
            ? (errField as Record<string, unknown>).message as string
            : JSON.stringify(errField)
        ) : "";
      resultText = errStr || (event.result as string) || "";
    } else {
      resultText = (event.result as string) ?? "";
    }
    return {
      text: resultText,
      isResult: true,
      isError,
      costUsd: event.cost_usd as number | undefined,
      durationMs: event.duration_ms as number | undefined,
      numTurns: event.num_turns as number | undefined,
      sessionId: eventSessionId,
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
    };
  }

  // system init event — no displayable text, but may carry session_id
  if (type === "system" && eventSessionId) {
    return { text: "", isResult: false, sessionId: eventSessionId };
  }

  if (type === "assistant" || type === "user") {
    const message = event.message as Record<string, unknown> | undefined;
    if (!message) return null;

    // Extract per-turn token usage from assistant messages (Claude Code v2.x
    // does not include usage on the result event — it's on each assistant turn)
    const usage = type === "assistant"
      ? (message.usage as Record<string, number> | undefined)
      : undefined;

    const content = message.content as ContentBlock[] | undefined;
    if (!content || !Array.isArray(content)) {
      if (usage?.input_tokens != null || usage?.output_tokens != null) {
        return { text: "", isResult: false, inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens };
      }
      return null;
    }

    const parts: string[] = [];

    for (const block of content) {
      if (block.type === "text" && block.text) {
        parts.push(block.text);
      } else if (block.type === "tool_use") {
        parts.push(`[Tool: ${block.name}]`);
      } else if (block.type === "tool_result") {
        const resultText = extractToolResultText(block.content);
        if (resultText) {
          parts.push(resultText);
        }
      }
    }

    if (parts.length === 0 && usage?.input_tokens == null && usage?.output_tokens == null) return null;
    return {
      text: parts.join("\n"),
      isResult: false,
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
    };
  }

  // Rate-limit utilization event — extract the utilization value for throttling
  if (type === "rate_limit_event") {
    const info = event.rate_limit_info as Record<string, unknown> | undefined;
    const utilization = typeof info?.utilization === "number" ? info.utilization : undefined;
    return { text: "", isResult: false, rateLimitUtilization: utilization };
  }

  // system messages and other types — skip
  return null;
}

/** Extract readable text from a tool_result content field */
function extractToolResultText(content: unknown): string | null {
  if (typeof content === "string") {
    // Truncate very long tool results for log readability
    return content.length > 500
      ? content.slice(0, 500) + "... (truncated)"
      : content;
  }
  if (Array.isArray(content)) {
    const texts = content
      .filter(
        (b: Record<string, unknown>) =>
          b.type === "text" && typeof b.text === "string",
      )
      .map((b: Record<string, unknown>) => b.text as string);
    const joined = texts.join("\n");
    return joined.length > 500
      ? joined.slice(0, 500) + "... (truncated)"
      : joined || null;
  }
  return null;
}

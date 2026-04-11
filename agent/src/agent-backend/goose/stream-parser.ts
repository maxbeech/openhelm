/**
 * Parse Goose `--output-format stream-json` output lines.
 *
 * Goose emits newline-delimited JSON to stdout. Event types (snake_case tag):
 *   - message    — agent message (assistant turn or user turn with tool results)
 *   - notification — MCP extension log/progress notifications
 *   - error      — fatal error from Goose
 *   - complete   — final event, carries optional total_tokens
 *
 * Message content items use camelCase tags (Rust serde rename_all = "camelCase"):
 *   text | toolRequest | toolResponse | thinking | redactedThinking | image | toolConfirmationRequest
 */

/** Parsed representation of a single Goose stream event */
export interface GooseParsedEvent {
  /** Human-readable text extracted from the event (may be empty string) */
  text: string;
  /** True only for the "complete" event */
  isComplete: boolean;
  /** Total tokens from the complete event (optional) */
  totalTokens?: number;
  /** Tool name when a toolRequest block is found */
  toolName?: string;
}

// ─── Message Content Types ────────────────────────────────────────────────────

interface TextContent {
  type: "text";
  text: string;
}

interface ToolRequestContent {
  type: "toolRequest";
  id: string;
  toolCall: { name: string; arguments: unknown };
}

interface ToolResponseContent {
  type: "toolResponse";
  id: string;
  toolResult: { Ok?: unknown; Err?: string };
}

interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

type MessageContent = TextContent | ToolRequestContent | ToolResponseContent | ThinkingContent | { type: string };

interface GooseMessage {
  role: "assistant" | "user";
  content: MessageContent[];
}

// ─── Public Parser ────────────────────────────────────────────────────────────

/**
 * Parse a single stream-json line from Goose into a GooseParsedEvent.
 * Returns null if the line has no actionable content.
 */
export function parseGooseStreamLine(line: string): GooseParsedEvent | null {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    // Not JSON — treat as raw text
    return line.trim() ? { text: line.trim(), isComplete: false } : null;
  }

  const type = event.type as string;

  if (type === "complete") {
    return {
      text: "",
      isComplete: true,
      totalTokens: typeof event.total_tokens === "number" ? event.total_tokens : undefined,
    };
  }

  if (type === "error") {
    const msg = typeof event.error === "string" ? event.error : JSON.stringify(event.error ?? "unknown error");
    return { text: `[Error] ${msg}`, isComplete: false };
  }

  if (type === "notification") {
    // Log-type notification from an extension — include as a log line
    if (typeof event.message === "string") {
      return { text: `[${event.extension_id ?? "ext"}] ${event.message}`, isComplete: false };
    }
    return null;
  }

  if (type === "message") {
    return parseMessageEvent(event.message as GooseMessage | undefined);
  }

  return null;
}

/** Extract text from a Goose message event */
function parseMessageEvent(message: GooseMessage | undefined): GooseParsedEvent | null {
  if (!message || !Array.isArray(message.content)) return null;

  const parts: string[] = [];
  let toolName: string | undefined;

  for (const block of message.content) {
    if (block.type === "text") {
      const b = block as TextContent;
      if (b.text) parts.push(b.text);
    } else if (block.type === "toolRequest") {
      const b = block as ToolRequestContent;
      const name = b.toolCall?.name ?? "unknown";
      toolName = name;
      parts.push(`[Tool: ${name}]`);
    } else if (block.type === "toolResponse") {
      const b = block as ToolResponseContent;
      const result = b.toolResult;
      if (result?.Ok != null) {
        const text = extractToolResultText(result.Ok);
        if (text) parts.push(text);
      } else if (result?.Err) {
        parts.push(`[Tool error] ${result.Err}`);
      }
    } else if (block.type === "thinking") {
      // Extended thinking — skip from display (same as Claude Code approach)
    }
    // image, redactedThinking, toolConfirmationRequest — skip
  }

  if (parts.length === 0) return null;
  return { text: parts.join("\n"), isComplete: false, toolName };
}

/** Extract readable text from a tool response Ok value */
function extractToolResultText(content: unknown): string | null {
  if (typeof content === "string") {
    return content.length > 500 ? content.slice(0, 500) + "... (truncated)" : content;
  }
  if (Array.isArray(content)) {
    const texts = content
      .filter((b): b is { type: "text"; text: string } => b != null && typeof b === "object" && b.type === "text")
      .map((b) => b.text);
    const joined = texts.join("\n");
    return joined.length > 500 ? joined.slice(0, 500) + "... (truncated)" : joined || null;
  }
  return null;
}

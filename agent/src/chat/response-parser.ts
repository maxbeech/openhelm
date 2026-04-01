/**
 * Parses LLM response text for <tool_call> blocks.
 * The AI outputs tool calls in this format:
 *   <tool_call>{"tool": "list_goals", "args": {}}</tool_call>
 */

import type { ChatToolCall } from "@openhelm/shared";

export interface ParsedResponse {
  /** Text segments between tool calls (in order). */
  textSegments: string[];
  /** Extracted tool calls (in order). */
  toolCalls: ChatToolCall[];
  hasToolCalls: boolean;
}

const TOOL_CALL_RE = /<tool_call>([\s\S]*?)<\/tool_call>/g;

/**
 * Escape literal control characters (newlines, tabs, etc.) inside JSON string
 * values so that JSON.parse can handle LLM output where the model forgot to
 * use \n escape sequences.  Operates only on characters between unescaped
 * double-quotes — structural whitespace between JSON tokens is left untouched.
 */
function repairJsonNewlines(raw: string): string {
  let result = "";
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (ch === "\\" && i + 1 < raw.length) {
        // Skip escaped character pair
        result += ch + raw[i + 1];
        i++;
      } else if (ch === '"') {
        result += ch;
        inString = false;
      } else if (ch === "\n") {
        result += "\\n";
      } else if (ch === "\r") {
        result += "\\r";
      } else if (ch === "\t") {
        result += "\\t";
      } else {
        result += ch;
      }
    } else {
      result += ch;
      if (ch === '"') inString = true;
    }
  }
  return result;
}

export function parseLlmResponse(text: string): ParsedResponse {
  const toolCalls: ChatToolCall[] = [];
  const textSegments: string[] = [];

  let lastIndex = 0;
  TOOL_CALL_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = TOOL_CALL_RE.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index).trim();
    if (before) textSegments.push(before);

    const rawJson = match[1].trim();
    let parsed: { tool: string; args?: Record<string, unknown> } | null = null;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      // LLMs often emit literal newlines inside JSON string values — repair and retry
      try {
        parsed = JSON.parse(repairJsonNewlines(rawJson));
      } catch (e2) {
        console.error("[chat] failed to parse tool_call JSON:", rawJson.slice(0, 200), e2);
      }
    }
    if (parsed) {
      toolCalls.push({ id: crypto.randomUUID(), tool: parsed.tool, args: parsed.args ?? {} });
    }

    lastIndex = match.index + match[0].length;
  }

  const remaining = text.slice(lastIndex).trim();
  if (remaining) textSegments.push(remaining);

  // Entire response is a text segment (no tool calls found)
  if (toolCalls.length === 0 && textSegments.length === 0 && text.trim()) {
    textSegments.push(text.trim());
  }

  return { textSegments, toolCalls, hasToolCalls: toolCalls.length > 0 };
}

/** Combine text segments into a clean response string (without tool_call blocks). */
export function buildTextResponse(textSegments: string[]): string {
  return textSegments.join("\n\n").trim();
}

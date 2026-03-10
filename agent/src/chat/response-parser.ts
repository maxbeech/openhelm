/**
 * Parses LLM response text for <tool_call> blocks.
 * The AI outputs tool calls in this format:
 *   <tool_call>{"tool": "list_goals", "args": {}}</tool_call>
 */

import type { ChatToolCall } from "@openorchestra/shared";

export interface ParsedResponse {
  /** Text segments between tool calls (in order). */
  textSegments: string[];
  /** Extracted tool calls (in order). */
  toolCalls: ChatToolCall[];
  hasToolCalls: boolean;
}

const TOOL_CALL_RE = /<tool_call>([\s\S]*?)<\/tool_call>/g;

export function parseLlmResponse(text: string): ParsedResponse {
  const toolCalls: ChatToolCall[] = [];
  const textSegments: string[] = [];

  let lastIndex = 0;
  TOOL_CALL_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = TOOL_CALL_RE.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index).trim();
    if (before) textSegments.push(before);

    try {
      const parsed = JSON.parse(match[1].trim()) as {
        tool: string;
        args?: Record<string, unknown>;
      };
      toolCalls.push({ id: crypto.randomUUID(), tool: parsed.tool, args: parsed.args ?? {} });
    } catch (e) {
      console.error("[chat] failed to parse tool_call JSON:", match[1].slice(0, 200), e);
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

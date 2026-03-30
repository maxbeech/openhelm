/**
 * Stream-json parsing utilities for Claude Code --print mode output.
 * Extracted from print.ts for file size management.
 */

import type { PrintConfig } from "./print.js";

/** Parse a single stream-json line and fire the appropriate callbacks. */
export function parseStreamJsonLine(line: string, config: PrintConfig): void {
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
export function extractResultFromStreamJson(lines: string[], preferAssistantText = false): string {
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

/**
 * Extract error details from stream-json result events.
 * Claude Code often reports errors (rate limit, API errors, etc.) in the
 * result event on stdout rather than writing to stderr.
 */
export function extractErrorFromStreamJson(lines: string[]): string {
  for (const line of lines) {
    let event: Record<string, unknown>;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === "result" && event.is_error) {
      const msg = (event.error as string) || (event.result as string) || "";
      if (msg) return msg;
    }
    if (event.type === "error" && typeof event.error === "object" && event.error) {
      const err = event.error as Record<string, unknown>;
      return (err.message as string) || JSON.stringify(err);
    }
  }
  return "";
}

/**
 * Extract session_id from stream-json lines (from result or system events).
 */
export function extractSessionId(lines: string[]): string | null {
  for (const line of lines) {
    let event: Record<string, unknown>;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === "result" && typeof event.session_id === "string") {
      return event.session_id;
    }
    if (event.type === "system" && typeof event.session_id === "string") {
      return event.session_id;
    }
  }
  return null;
}

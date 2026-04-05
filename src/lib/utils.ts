import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Transform a raw error into a user-friendly message.
 * @param err - The caught error value
 * @param context - Action context prefix, e.g. "Failed to load goals"
 */
export function friendlyError(err: unknown, context: string): string {
  const raw = err instanceof Error ? err.message : String(err);

  // Claude Code LLM timeout: the AI process was killed for being too slow.
  // This is distinct from the agent process itself being unresponsive.
  if (raw.includes("Claude Code timed out")) {
    return "The AI response timed out. Your request may be complex — try breaking it into smaller parts, or send the same message again.";
  }
  // Generic IPC/heartbeat timeout: the agent process is not responding.
  if (raw.toLowerCase().includes("timed out")) {
    return "The agent is not responding. Try again or restart the app.";
  }

  // Detect auth/login errors and surface a clear message
  const lower = raw.toLowerCase();
  if (
    /not.*log.*in|unauthenticated|unauthorized|expired.*session|sign.?in.*required/i.test(lower)
  ) {
    return "Claude Code is not logged in. Run `claude` in your terminal to log in, then try again.";
  }

  // JSON-RPC error codes like "-32001: Some message"
  const rpcMatch = raw.match(/-\d{5}:\s*(.+)/);
  if (rpcMatch) {
    return rpcMatch[1].trim();
  }

  return `${context}: ${raw}`;
}

/**
 * Maps a full Claude model ID (e.g. "claude-haiku-4-5-20251001") or short name
 * to the canonical short name used in the UI: "sonnet" | "haiku" | "opus".
 */
export function normalizeModelShortName(model: string | null | undefined): "sonnet" | "haiku" | "opus" {
  if (!model) return "sonnet";
  if (model.includes("haiku")) return "haiku";
  if (model.includes("opus")) return "opus";
  return "sonnet";
}

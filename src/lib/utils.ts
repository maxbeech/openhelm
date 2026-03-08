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

  if (raw.toLowerCase().includes("timed out")) {
    return "The agent is not responding. Try again or restart the app.";
  }

  // JSON-RPC error codes like "-32001: Some message"
  const rpcMatch = raw.match(/-\d{5}:\s*(.+)/);
  if (rpcMatch) {
    return rpcMatch[1].trim();
  }

  return `${context}: ${raw}`;
}

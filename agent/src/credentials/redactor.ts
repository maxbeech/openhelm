/**
 * Log redactor — replaces secret values with [REDACTED] in text output.
 *
 * Used to ensure credential values never appear in:
 * - SQLite run_logs table
 * - IPC events sent to the frontend
 * - Run summaries
 */

/**
 * Create a redaction function that replaces any occurrence of any secret
 * with [REDACTED]. Secrets are matched longest-first to avoid partial matches.
 *
 * Returns a no-op passthrough if no secrets are provided.
 */
export function createRedactor(secrets: string[]): (text: string) => string {
  // Filter out empty/short secrets that would cause false positives
  const validSecrets = secrets.filter((s) => s.length >= 3);
  if (validSecrets.length === 0) return (t) => t;

  // Sort longest-first so longer secrets are matched before shorter substrings
  const sorted = [...validSecrets].sort((a, b) => b.length - a.length);
  const escaped = sorted.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(escaped.join("|"), "g");

  return (text: string) => text.replace(pattern, "[REDACTED]");
}

/**
 * Extract all secret string values from a CredentialValue for redaction.
 */
export function extractSecretStrings(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const v = value as Record<string, unknown>;
  const secrets: string[] = [];

  if (typeof v.value === "string" && v.value.length >= 3) {
    secrets.push(v.value);
  }
  if (typeof v.username === "string" && v.username.length >= 3) {
    secrets.push(v.username);
  }
  if (typeof v.password === "string" && v.password.length >= 3) {
    secrets.push(v.password);
  }

  return secrets;
}

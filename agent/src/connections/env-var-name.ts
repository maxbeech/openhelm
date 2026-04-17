/**
 * Utilities for auto-generating environment variable names from connection names.
 * Re-export from legacy path for backward compatibility.
 */

export function generateEnvVarName(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return `OPENHELM_${slug || "CONNECTION"}`;
}

export function deduplicateEnvVarName(base: string, existing: string[]): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

/**
 * Utilities for auto-generating environment variable names from credential names.
 *
 * All generated names are prefixed with OPENHELM_ to avoid collisions with
 * system or user environment variables.
 */

/**
 * Convert a credential name to an OPENHELM_* environment variable name.
 *
 * Examples:
 *   "GitHub Token"    → OPENHELM_GITHUB_TOKEN
 *   "My API Key"      → OPENHELM_MY_API_KEY
 *   "db-password"     → OPENHELM_DB_PASSWORD
 *   "  "              → OPENHELM_CREDENTIAL
 */
export function generateEnvVarName(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return `OPENHELM_${slug || "CREDENTIAL"}`;
}

/**
 * Deduplicate an env var name against a list of existing names.
 * Appends _2, _3, etc. until a free name is found.
 *
 * @param base      The generated base name (e.g. OPENHELM_GITHUB_TOKEN)
 * @param existing  All env_var_name values currently in the DB (caller excludes self)
 */
export function deduplicateEnvVarName(
  base: string,
  existing: string[],
): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

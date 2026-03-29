/**
 * Writes browser-injectable credentials to a temp file for the MCP server.
 *
 * The file is written with 0600 permissions and a random UUID in the name.
 * The MCP server reads and deletes it immediately on startup, so the file
 * exists on disk for <1 second.
 */

import { writeFileSync, mkdirSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const BROWSER_CREDS_DIR = join(
  process.env.OPENHELM_DATA_DIR ?? join(homedir(), ".openhelm"),
  "browser-credentials",
);

export interface BrowserCredential {
  name: string;
  type: "token" | "username_password";
  /** Present when type === "token" */
  value?: string;
  /** Present when type === "username_password" */
  username?: string;
  /** Present when type === "username_password" */
  password?: string;
}

/**
 * Write browser credentials to a temp JSON file.
 * Returns the absolute path to the file.
 */
export function writeBrowserCredentialsFile(
  runId: string,
  credentials: BrowserCredential[],
): string {
  mkdirSync(BROWSER_CREDS_DIR, { recursive: true });
  const fileName = `run-${runId}-${crypto.randomUUID()}.json`;
  const filePath = join(BROWSER_CREDS_DIR, fileName);
  const payload = JSON.stringify({ credentials }, null, 2);
  writeFileSync(filePath, payload, { mode: 0o600 });
  return filePath;
}

/** Defensive cleanup — the MCP server should have already deleted the file. */
export function removeBrowserCredentialsFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Already deleted by MCP server — expected
  }
}

/**
 * Sweep orphaned credential files from ~/.openhelm/browser-credentials/.
 * Called at agent startup to clean up after crashes where the MCP server
 * never got to delete the file.
 */
export function cleanupOrphanedBrowserCredentials(): void {
  try {
    const files = readdirSync(BROWSER_CREDS_DIR);
    for (const file of files) {
      if (file.startsWith("run-") && file.endsWith(".json")) {
        try {
          unlinkSync(join(BROWSER_CREDS_DIR, file));
        } catch {
          // ignore
        }
      }
    }
    if (files.length > 0) {
      console.error(`[browser-credentials] cleaned up ${files.length} orphaned credential file(s)`);
    }
  } catch {
    // Directory doesn't exist yet — nothing to clean
  }
}

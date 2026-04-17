/**
 * One-shot migration: rename legacy browser-profile directories from
 * `cred-<id>` (pre-plan-14b naming) to `conn-<id>` (current naming).
 *
 * Runs at agent startup after initDatabase(). Idempotent — safe to call
 * on every boot; skips entries that are already renamed.
 */

import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getDb } from "../db/init.js";
import { connections } from "../db/schema.js";
import { eq } from "drizzle-orm";

function getProfilesRoot(): string {
  return join(
    process.env.OPENHELM_DATA_DIR ?? join(homedir(), ".openhelm"),
    "profiles",
  );
}

export function migrateProfileDirs(): void {
  const root = getProfilesRoot();
  if (!existsSync(root)) return;

  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch (err) {
    console.error("[profile-dir-migration] could not read profiles dir (non-fatal):", err);
    return;
  }

  const metaPath = join(root, "profiles.json");
  let meta: Record<string, unknown> = {};
  try {
    if (existsSync(metaPath)) {
      meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    }
  } catch { /* ignore */ }

  let metaDirty = false;

  for (const entry of entries) {
    if (!entry.startsWith("cred-")) continue;

    const connectionId = entry.slice("cred-".length);
    const newName = `conn-${connectionId}`;
    const oldPath = join(root, entry);
    const newPath = join(root, newName);

    if (existsSync(newPath)) {
      // Already renamed; just clean up the old dir if it exists as a duplicate
      console.error(`[profile-dir-migration] ${newName} already exists, skipping`);
      continue;
    }

    try {
      renameSync(oldPath, newPath);
      console.error(`[profile-dir-migration] renamed ${entry} → ${newName}`);
    } catch (err) {
      console.error(`[profile-dir-migration] rename failed for ${entry} (non-fatal):`, err);
      continue;
    }

    // Update profiles.json metadata
    if (meta[entry] !== undefined) {
      meta[newName] = meta[entry];
      delete meta[entry];
      metaDirty = true;
    }

    // Update the connections row if it still references the old profile name
    try {
      const db = getDb();
      db.update(connections)
        .set({ browserProfileName: newName, updatedAt: new Date().toISOString() })
        .where(eq(connections.browserProfileName, entry))
        .run();
    } catch (err) {
      console.error(`[profile-dir-migration] DB update failed for ${entry} (non-fatal):`, err);
    }
  }

  if (metaDirty) {
    try {
      writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    } catch (err) {
      console.error("[profile-dir-migration] profiles.json write failed (non-fatal):", err);
    }
  }
}

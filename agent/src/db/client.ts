/**
 * Database client factory — returns the appropriate Drizzle client
 * for the current runtime mode.
 *
 * Local mode  (default): SQLite via better-sqlite3 + existing init.ts
 * Cloud mode  (OPENHELM_MODE=cloud): Postgres via postgres.js + Supabase
 *
 * Usage:
 *   import { getDb } from './client.js';
 *   const db = getDb();
 *
 * The cloud path requires SUPABASE_DB_URL (direct Postgres connection string).
 * The Worker Service sets this; the desktop agent sidecar never uses it.
 */

import { getDb as getSqliteDb, initDatabase } from "./init.js";

export type DbMode = "local" | "cloud";

/** Returns the active runtime mode. */
export function getMode(): DbMode {
  return process.env.OPENHELM_MODE === "cloud" ? "cloud" : "local";
}

/**
 * Returns the Drizzle DB client for the current mode.
 *
 * - Local: delegates to the existing SQLite init.ts singleton.
 * - Cloud: lazily initialises a Drizzle Postgres client backed by Supabase.
 *
 * In both cases the return type is the Drizzle query-builder interface.
 * Callers that need the exact typed schema should import from schema.ts or
 * schema-postgres.ts directly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDb(): any {
  if (getMode() === "cloud") {
    return getCloudDb();
  }
  return getSqliteDb();
}

// ── Cloud client (lazy singleton) ─────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _cloudDb: any | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getCloudDb(): any {
  if (_cloudDb) return _cloudDb;

  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "[db/client] SUPABASE_DB_URL must be set when OPENHELM_MODE=cloud. " +
      "Set it to the Supabase direct connection string (postgres://...).",
    );
  }

  // Dynamic imports so the `postgres` package is only required in cloud mode.
  // The desktop agent sidecar never reaches this path.
  try {
    // drizzle-orm/postgres-js + postgres npm package
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle } = require("drizzle-orm/postgres-js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require("postgres");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const schema = require("./schema-postgres.js");

    const sql = postgres(url, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
    });

    _cloudDb = drizzle(sql, { schema });
    console.error("[agent] cloud database client initialised (Supabase Postgres)");
    return _cloudDb;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[db/client] Failed to initialise cloud database client: ${detail}\n` +
      "Ensure the 'postgres' npm package is installed (npm add postgres).",
    );
  }
}

/**
 * Initialise the database. In local mode, this runs SQLite migrations.
 * In cloud mode, migrations are applied via Supabase MCP / CLI — this is a no-op.
 */
export function initDb(dbPath?: string): void {
  if (getMode() === "cloud") {
    // Cloud mode: migrations managed externally; just warm up the connection.
    getCloudDb();
    return;
  }
  initDatabase(dbPath);
}

/** Reset the cloud client singleton (used in tests). */
export function resetCloudDb(): void {
  _cloudDb = null;
}

import Database from "better-sqlite3";
import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as schema from "./schema.js";

const DATA_DIR = join(homedir(), ".openorchestra");
const DB_PATH = join(DATA_DIR, "openorchestra.db");

let dbInstance: BetterSQLite3Database<typeof schema> | null = null;

export function initDatabase(dbPath?: string) {
  const resolvedPath = dbPath ?? DB_PATH;
  const resolvedDir =
    dbPath != null ? join(resolvedPath, "..") : DATA_DIR;

  // Ensure data directory exists
  if (!existsSync(resolvedDir)) {
    mkdirSync(resolvedDir, { recursive: true });
  }

  try {
    const sqlite = new Database(resolvedPath);

    // Enable WAL mode for better concurrent read performance
    sqlite.pragma("journal_mode = WAL");
    // Enforce foreign key constraints
    sqlite.pragma("foreign_keys = ON");
    // Performance: write durability trade-off (safe with WAL)
    sqlite.pragma("synchronous = NORMAL");
    // 64 MB page cache
    sqlite.pragma("cache_size = -64000");
    // Keep temp tables in memory
    sqlite.pragma("temp_store = MEMORY");
    // Wait up to 5 s on locked DB before failing
    sqlite.pragma("busy_timeout = 5000");

    const db = drizzle(sqlite, { schema });

    // Run migrations
    const migrationsPath =
      process.env.OPENORCHESTRA_MIGRATIONS_PATH ||
      join(import.meta.dirname, "migrations");

    migrate(db, { migrationsFolder: migrationsPath });

    dbInstance = db;
    console.error(`[agent] database initialized at ${resolvedPath}`);
    return db;
  } catch (err: unknown) {
    // Handle disk-full errors from better-sqlite3
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "SQLITE_FULL"
    ) {
      throw new Error(
        "OpenOrchestra couldn't save data. Your disk may be full.",
      );
    }

    // Rethrow with additional context for other database errors
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Database initialization failed at ${resolvedPath}: ${detail}`,
    );
  }
}

/** Get the initialized database instance. Throws if not yet initialized. */
export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!dbInstance) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return dbInstance;
}

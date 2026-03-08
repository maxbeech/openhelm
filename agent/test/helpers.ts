import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initDatabase } from "../src/db/init.js";

/**
 * Create a fresh test database in a temporary directory.
 * Returns a cleanup function that removes the temp dir.
 */
export function setupTestDb(): () => void {
  const tempDir = mkdtempSync(join(tmpdir(), "oo-test-"));
  const dbPath = join(tempDir, "test.db");

  // Point migrations to the source directory
  process.env.OPENORCHESTRA_MIGRATIONS_PATH = join(
    import.meta.dirname,
    "..",
    "src",
    "db",
    "migrations",
  );

  initDatabase(dbPath);

  return () => {
    rmSync(tempDir, { recursive: true, force: true });
  };
}

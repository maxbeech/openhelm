/**
 * Tests for agent/src/db/client.ts
 *
 * Verifies:
 *  - getMode() returns 'local' by default
 *  - getMode() returns 'cloud' when OPENHELM_MODE=cloud
 *  - getDb() in local mode delegates to SQLite init
 *  - getDb() in cloud mode throws without SUPABASE_DB_URL
 *  - getDb() in cloud mode throws with a helpful message if postgres package is missing
 *  - initDb() in cloud mode is a no-op (no SQLite migration called)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// We mock the SQLite init module to avoid needing an actual DB file in tests
vi.mock("../src/db/init.js", () => ({
  getDb:        vi.fn().mockReturnValue({ _sqlite: true }),
  initDatabase: vi.fn(),
}));

// Import after mocking
import { getMode, getDb, initDb, resetCloudDb } from "../src/db/client.js";
import { getDb as getSqliteDb, initDatabase } from "../src/db/init.js";

describe("getMode()", () => {
  afterEach(() => {
    delete process.env.OPENHELM_MODE;
  });

  it("returns 'local' by default", () => {
    delete process.env.OPENHELM_MODE;
    expect(getMode()).toBe("local");
  });

  it("returns 'local' when OPENHELM_MODE=local", () => {
    process.env.OPENHELM_MODE = "local";
    expect(getMode()).toBe("local");
  });

  it("returns 'cloud' when OPENHELM_MODE=cloud", () => {
    process.env.OPENHELM_MODE = "cloud";
    expect(getMode()).toBe("cloud");
  });

  it("returns 'local' for unknown OPENHELM_MODE values", () => {
    process.env.OPENHELM_MODE = "hybrid";
    expect(getMode()).toBe("local");
  });
});

describe("getDb() — local mode", () => {
  beforeEach(() => {
    delete process.env.OPENHELM_MODE;
  });

  it("delegates to SQLite getDb()", () => {
    const db = getDb();
    expect(getSqliteDb).toHaveBeenCalled();
    expect(db).toEqual({ _sqlite: true });
  });
});

describe("getDb() — cloud mode", () => {
  beforeEach(() => {
    process.env.OPENHELM_MODE = "cloud";
    delete process.env.SUPABASE_DB_URL;
    resetCloudDb();
  });

  afterEach(() => {
    delete process.env.OPENHELM_MODE;
    delete process.env.SUPABASE_DB_URL;
    resetCloudDb();
  });

  it("throws with a clear message when SUPABASE_DB_URL is not set", () => {
    expect(() => getDb()).toThrow(/SUPABASE_DB_URL must be set/);
  });

  it("throws with a clear message when postgres package is not available", () => {
    process.env.SUPABASE_DB_URL = "postgres://user:pass@localhost:5432/db";
    // The postgres package is not installed in agent/ — this should fail gracefully
    expect(() => getDb()).toThrow(/Failed to initialise cloud database client|Cannot find module/i);
  });
});

describe("initDb()", () => {
  afterEach(() => {
    delete process.env.OPENHELM_MODE;
    delete process.env.SUPABASE_DB_URL;
    resetCloudDb();
  });

  it("calls initDatabase() in local mode", () => {
    delete process.env.OPENHELM_MODE;
    vi.mocked(initDatabase).mockClear();
    initDb("/tmp/test.db");
    expect(initDatabase).toHaveBeenCalledWith("/tmp/test.db");
  });

  it("is a no-op for migrations in cloud mode (throws without DB URL)", () => {
    process.env.OPENHELM_MODE = "cloud";
    vi.mocked(initDatabase).mockClear();
    // Cloud mode without DB URL throws, but initDatabase should NOT be called
    expect(() => initDb()).toThrow();
    expect(initDatabase).not.toHaveBeenCalled();
  });
});

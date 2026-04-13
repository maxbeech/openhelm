import type Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations-data.js";

const MIGRATIONS_TABLE = "__openhelm_migrations";
const DRIZZLE_TABLE = "__drizzle_migrations";

/**
 * Runs pending migrations against a raw better-sqlite3 Database.
 * SQL is embedded at build time — no filesystem access required at runtime.
 * Uses its own tracking table so it never conflicts with Drizzle's.
 *
 * On first run, bootstraps from __drizzle_migrations if present so that
 * databases previously managed by Drizzle's file-based migrator are handled.
 */
export function runMigrations(sqlite: Database.Database): void {
  sqlite
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        idx        INTEGER PRIMARY KEY,
        tag        TEXT    NOT NULL,
        applied_at TEXT    NOT NULL
      )`,
    )
    .run();

  const applied = new Set<number>(
    (
      sqlite
        .prepare(`SELECT idx FROM ${MIGRATIONS_TABLE}`)
        .all() as { idx: number }[]
    ).map((r) => r.idx),
  );

  // Bootstrap: if our table is empty but Drizzle's table has entries,
  // pre-populate our table for every migration Drizzle already applied.
  if (applied.size === 0) {
    const drizzleExists =
      (
        sqlite
          .prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
          )
          .get(DRIZZLE_TABLE) as { name: string } | undefined
      ) != null;

    if (drizzleExists) {
      const drizzleRows = sqlite
        .prepare(`SELECT rowid FROM ${DRIZZLE_TABLE} ORDER BY rowid`)
        .all() as { rowid: number }[];

      if (drizzleRows.length > 0) {
        const insert = sqlite.prepare(
          `INSERT OR IGNORE INTO ${MIGRATIONS_TABLE} (idx, tag, applied_at) VALUES (?, ?, ?)`,
        );
        const bootstrapAll = sqlite.transaction(() => {
          for (let i = 0; i < drizzleRows.length && i < MIGRATIONS.length; i++) {
            insert.run(MIGRATIONS[i].idx, MIGRATIONS[i].tag, new Date().toISOString());
            applied.add(MIGRATIONS[i].idx);
          }
        });
        bootstrapAll();
        console.error(
          `[agent] bootstrapped ${drizzleRows.length} migrations from ${DRIZZLE_TABLE}`,
        );
      }
    }
  }

  const pending = MIGRATIONS.filter((m) => !applied.has(m.idx));
  if (pending.length === 0) return;

  const record = sqlite.prepare(
    `INSERT INTO ${MIGRATIONS_TABLE} (idx, tag, applied_at) VALUES (?, ?, ?)`,
  );

  const applyAll = sqlite.transaction(() => {
    for (const migration of pending) {
      // Split on Drizzle's statement-breakpoint marker first, then on semicolons.
      // Hand-written migrations may lack breakpoints but still have multiple
      // statements separated by semicolons.
      //
      // 2026-04-12 (Round 10): chunks containing a CREATE TRIGGER with a
      // BEGIN ... END block are NOT split on semicolons — the trigger
      // body has internal semicolons that would fragment into invalid
      // statements. Such chunks are run via better-sqlite3's `.exec()`
      // method which accepts multi-statement SQL.
      const chunks = migration.sql.split("--> statement-breakpoint");
      const statements: string[] = [];
      for (const chunk of chunks) {
        // Strip line comments before splitting on semicolons so comment text
        // containing semicolons doesn't produce spurious empty statements.
        const stripped = chunk.replace(/--[^\n]*/g, "");
        // Detect a trigger body: BEGIN ... END inside the stripped text.
        // If present, keep the whole chunk as one statement entry.
        if (/\bBEGIN\b[\s\S]*\bEND\b/i.test(stripped)) {
          const trimmed = stripped.trim();
          if (trimmed) statements.push(trimmed);
          continue;
        }
        for (const stmt of stripped.split(";")) {
          const trimmed = stmt.trim();
          if (trimmed) statements.push(trimmed);
        }
      }

      for (const stmt of statements) {
        // Multi-statement blocks (CREATE TRIGGER ... BEGIN ... END)
        // must go through `.exec()` — `.prepare()` rejects compound
        // SQL with "incomplete input". Single statements go through
        // `.prepare().run()` which catches syntax errors eagerly.
        if (/\bBEGIN\b[\s\S]*\bEND\b/i.test(stmt)) {
          sqlite.exec(stmt);
        } else {
          sqlite.prepare(stmt).run();
        }
      }

      record.run(migration.idx, migration.tag, new Date().toISOString());
      console.error(`[agent] migration applied: ${migration.tag}`);
    }
  });

  applyAll();
}

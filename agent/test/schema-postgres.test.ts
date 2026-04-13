/**
 * Tests for schema-postgres.ts
 *
 * Verifies structural completeness of the Postgres schema:
 *  - All SQLite tables have a Postgres counterpart
 *  - Every table has a user_id column for multi-tenant RLS
 *  - Cloud-only tables (usage_records, subscriptions) exist
 *  - REALTIME_CHANNELS helper generates correct channel names
 *
 * These are pure structural tests — no database connection required.
 */

import { describe, it, expect } from "vitest";
import { getTableName } from "drizzle-orm";
import * as pg from "../src/db/schema-postgres.js";
import * as sqlite from "../src/db/schema.js";

// ── Helper: extract DB column names from a Drizzle table ─────────────────────

// Drizzle exposes columns via the Symbol.for("drizzle:Columns") symbol.
const DRIZZLE_COLUMNS = Symbol.for("drizzle:Columns");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function colNames(table: any): string[] {
  const cols: Record<string, { name: string }> = table[DRIZZLE_COLUMNS] ?? {};
  return Object.values(cols).map((c) => c.name);
}

// ── Table presence tests ──────────────────────────────────────────────────────

describe("schema-postgres — table presence", () => {
  it("exports all SQLite tables as Postgres counterparts", () => {
    const sqliteTableNames = [
      "settings", "projects", "goals", "jobs", "runs",
      "conversations", "messages", "memories", "runMemories",
      "autopilotProposals", "credentials", "credentialScopeBindings",
      "runCredentials", "dataTables", "dataTableRows", "dataTableChanges",
      "claudeUsageSnapshots", "targets", "visualizations",
      "inboxEvents", "runLogs", "dashboardItems",
    ];

    for (const name of sqliteTableNames) {
      expect(pg, `${name} missing from schema-postgres`).toHaveProperty(name);
    }
  });

  it("exports cloud-only tables", () => {
    expect(pg).toHaveProperty("usageRecords");
    expect(pg).toHaveProperty("subscriptions");
  });
});

// ── user_id presence on every entity table ────────────────────────────────────

describe("schema-postgres — user_id on all tables", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ENTITY_TABLES: Array<[string, any]> = [
    ["projects",                pg.projects],
    ["goals",                   pg.goals],
    ["jobs",                    pg.jobs],
    ["runs",                    pg.runs],
    ["conversations",           pg.conversations],
    ["messages",                pg.messages],
    ["dashboardItems",          pg.dashboardItems],
    ["memories",                pg.memories],
    ["runMemories",             pg.runMemories],
    ["autopilotProposals",      pg.autopilotProposals],
    ["credentials",             pg.credentials],
    ["credentialScopeBindings", pg.credentialScopeBindings],
    ["runCredentials",          pg.runCredentials],
    ["dataTables",              pg.dataTables],
    ["dataTableRows",           pg.dataTableRows],
    ["dataTableChanges",        pg.dataTableChanges],
    ["claudeUsageSnapshots",    pg.claudeUsageSnapshots],
    ["targets",                 pg.targets],
    ["visualizations",          pg.visualizations],
    ["inboxEvents",             pg.inboxEvents],
    ["runLogs",                 pg.runLogs],
    ["usageRecords",            pg.usageRecords],
    ["subscriptions",           pg.subscriptions],
  ];

  for (const [name, table] of ENTITY_TABLES) {
    it(`${name} has user_id column`, () => {
      const cols = colNames(table);
      expect(cols, `${name} is missing user_id`).toContain("user_id");
    });
  }
});

// ── Cloud-only table columns ───────────────────────────────────────────────────

describe("schema-postgres — usage_records columns", () => {
  it("has all required billing columns", () => {
    const cols = colNames(pg.usageRecords);
    expect(cols).toContain("id");
    expect(cols).toContain("user_id");
    expect(cols).toContain("call_type");
    expect(cols).toContain("model");
    expect(cols).toContain("input_tokens");
    expect(cols).toContain("output_tokens");
    expect(cols).toContain("raw_cost_usd");
    expect(cols).toContain("billed_cost_usd");
    expect(cols).toContain("created_at");
  });
});

describe("schema-postgres — subscriptions columns", () => {
  it("has all required subscription management columns", () => {
    const cols = colNames(pg.subscriptions);
    expect(cols).toContain("user_id");
    expect(cols).toContain("stripe_customer_id");
    expect(cols).toContain("stripe_subscription_id");
    expect(cols).toContain("plan");
    expect(cols).toContain("status");
    expect(cols).toContain("included_token_credits");
    expect(cols).toContain("used_token_credits");
  });
});

// ── Realtime channel names ─────────────────────────────────────────────────────

describe("REALTIME_CHANNELS", () => {
  it("generates run stream channel correctly", () => {
    expect(pg.REALTIME_CHANNELS.runStream("run_abc123")).toBe("run:run_abc123");
  });

  it("generates user events channel correctly", () => {
    const uid = "550e8400-e29b-41d4-a716-446655440000";
    expect(pg.REALTIME_CHANNELS.userEvents(uid)).toBe(`user:${uid}:events`);
  });
});

// ── Schema parity: SQLite tables map to Postgres tables ───────────────────────

describe("schema-postgres — parity with SQLite schema", () => {
  // The Postgres schema uses camelCase exports matching the SQLite schema.
  const PARITY_PAIRS: Array<[string, string]> = [
    ["projects",   "projects"],
    ["goals",      "goals"],
    ["jobs",       "jobs"],
    ["runs",       "runs"],
    ["memories",   "memories"],
    ["dataTables", "dataTables"],
    ["runLogs",    "runLogs"],
  ];

  for (const [pgName, sqliteName] of PARITY_PAIRS) {
    it(`${pgName} exports same table name as SQLite counterpart`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pgTable     = (pg     as Record<string, any>)[pgName];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sqliteTable = (sqlite as Record<string, any>)[sqliteName];

      expect(pgTable,     `pg.${pgName} not found`         ).toBeDefined();
      expect(sqliteTable, `sqlite.${sqliteName} not found` ).toBeDefined();

      const pgTableName     = getTableName(pgTable);
      const sqliteTableName = getTableName(sqliteTable);

      expect(pgTableName,     `pg.${pgName} table name`    ).toBeTruthy();
      expect(sqliteTableName, `sqlite.${sqliteName} table name`).toBeTruthy();
      expect(pgTableName).toBe(sqliteTableName);
    });
  }
});

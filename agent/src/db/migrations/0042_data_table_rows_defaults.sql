-- Round 10 (2026-04-12): add an autofill view so raw sqlite3 INSERT
-- statements from agents (via the Bash tool) can write data_table_rows
-- without hitting NOT NULL constraint errors on id/updated_at.
--
-- Before this migration, agents writing to data_table_rows via raw
-- sqlite3 commands would fail with:
--
--   Runtime error near line 1: NOT NULL constraint failed:
--     data_table_rows.id (19)
--   Runtime error near line 11: NOT NULL constraint failed:
--     data_table_rows.updated_at (19)
--
-- The schema requires a non-null `id` (primary key) and non-null
-- `updated_at`, but Drizzle's `$defaultFn` runs at the application
-- layer and never participates when Drizzle is bypassed by raw SQL.
-- SQLite BEFORE INSERT triggers cannot modify NEW values, and adding
-- a DEFAULT clause to an existing NOT NULL column requires rewriting
-- the table — disruptive and risky with live prod data.
--
-- The fix is a view (`data_table_rows_autofill`) with an INSTEAD OF
-- INSERT trigger that rewrites the insert to fill in missing values:
--
--   INSERT INTO data_table_rows_autofill (table_id, data)
--   VALUES ('tbl_xxx', '{"col_abc":"hello"}');
--
-- is transparently rewritten to a real INSERT into data_table_rows
-- with a pseudo-UUID id and ISO-8601 timestamps for created_at and
-- updated_at.
--
-- Agents writing via the `openhelm_data` MCP tools are unaffected —
-- those go through Drizzle and already work. This view is the escape
-- hatch when the Bash tool is the only option.
--
-- The generated id matches the shape Drizzle produces (8-4-4-4-12
-- hex segments) but is NOT a real UUIDv4 (no version/variant bits).
-- Uniqueness is guaranteed by the primary key.

DROP VIEW IF EXISTS data_table_rows_autofill;

CREATE VIEW data_table_rows_autofill AS
SELECT id, table_id, data, sort_order, created_at, updated_at
FROM data_table_rows;

DROP TRIGGER IF EXISTS data_table_rows_autofill_insert;

CREATE TRIGGER data_table_rows_autofill_insert
INSTEAD OF INSERT ON data_table_rows_autofill
FOR EACH ROW
BEGIN
  INSERT INTO data_table_rows (id, table_id, data, sort_order, created_at, updated_at)
  VALUES (
    COALESCE(
      NEW.id,
      lower(hex(randomblob(4))) || '-' ||
      lower(hex(randomblob(2))) || '-' ||
      lower(hex(randomblob(2))) || '-' ||
      lower(hex(randomblob(2))) || '-' ||
      lower(hex(randomblob(6)))
    ),
    NEW.table_id,
    COALESCE(NEW.data, '{}'),
    COALESCE(NEW.sort_order, 0),
    COALESCE(NEW.created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    COALESCE(NEW.updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
END;

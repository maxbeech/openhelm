-- Reconcile stale row_count values in data_tables.
-- row_count is a denormalized cache that can fall out of sync when rows are
-- inserted outside the insertDataTableRows() path (e.g. direct SQL by a job).
-- This migration recomputes it for every table from the actual data_table_rows count.

UPDATE data_tables
SET row_count = (
  SELECT COUNT(*)
  FROM data_table_rows
  WHERE data_table_rows.table_id = data_tables.id
),
updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE row_count != (
  SELECT COUNT(*)
  FROM data_table_rows
  WHERE data_table_rows.table_id = data_tables.id
);

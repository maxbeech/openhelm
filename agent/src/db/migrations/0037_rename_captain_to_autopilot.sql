-- Migration 0037: rename Captain → Autopilot branding in data_tables,
-- add description column to visualizations, and delete stale auto-generated
-- visualizations so the seeder recreates them with correct config.

-- 1. Rename system data tables
UPDATE data_tables
SET name = 'Autopilot Rules'
WHERE name = 'Captain Rules' AND is_system = 1;

UPDATE data_tables
SET name = 'Autopilot Metrics'
WHERE name = 'Captain Metrics' AND is_system = 1;

-- 2. Add description column to visualizations
ALTER TABLE visualizations ADD COLUMN description TEXT;

-- 3. Delete stale auto-generated visualizations for these system tables
--    (the seeder will recreate them with correct chart type and pretty labels)
DELETE FROM visualizations
WHERE source = 'system'
  AND data_table_id IN (
    SELECT id FROM data_tables
    WHERE name IN ('Autopilot Rules', 'Autopilot Metrics')
      AND is_system = 1
  );

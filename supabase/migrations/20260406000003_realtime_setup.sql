-- ============================================================
-- Postgres Realtime: track changes to key tables.
-- REPLICA IDENTITY FULL ensures UPDATE/DELETE events carry
-- the full old row so the frontend can reconcile state.
-- ============================================================

ALTER TABLE runs           REPLICA IDENTITY FULL;
ALTER TABLE inbox_events   REPLICA IDENTITY FULL;
ALTER TABLE inbox_items    REPLICA IDENTITY FULL;
ALTER TABLE jobs           REPLICA IDENTITY FULL;
ALTER TABLE run_logs       REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE runs;
ALTER PUBLICATION supabase_realtime ADD TABLE inbox_events;
ALTER PUBLICATION supabase_realtime ADD TABLE inbox_items;
ALTER PUBLICATION supabase_realtime ADD TABLE jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE run_logs;

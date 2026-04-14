-- ============================================================
-- Plan 13 — Demo runs cleanup
--
-- Before the scheduler learned to skip demo projects, cloud worker ticks
-- were picking up demo jobs (is_enabled=true, next_fire_at due) and
-- attempting to execute them against the demo owner user. These runs
-- failed en masse because demo users have no real credentials/MCP
-- surface, filling the demo dashboard with noise.
--
-- This migration deletes every run row for demo projects that did NOT
-- come from a seed migration. Seeded run ids follow the "demo-<slug>-run-N"
-- convention, so we key off that. Run logs cascade via their run_id FK.
-- ============================================================

DELETE FROM runs
 WHERE job_id IN (
   SELECT j.id FROM jobs j
     JOIN projects p ON p.id = j.project_id
    WHERE p.is_demo = true
 )
   AND id NOT LIKE 'demo-%-run-%';

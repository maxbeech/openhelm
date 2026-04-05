-- Cleanup: archive completed one-shot investigation jobs.
-- The scheduler disables one-shot jobs after they fire, but doesn't archive
-- them — so they accumulated as clutter under the Autopilot Maintenance goal.
-- Going forward, post-run.ts archives them immediately after processing.

-- Archive every investigation job that has a terminal run (succeeded/failed/
-- permanent_failure/cancelled). Jobs that have never run remain untouched so
-- the scheduler can still fire them.
UPDATE jobs
SET is_archived = 1,
    is_enabled = 0,
    next_fire_at = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE system_category = 'captain_investigation'
  AND is_archived = 0
  AND id IN (
    SELECT DISTINCT job_id FROM runs
    WHERE status IN ('succeeded', 'failed', 'permanent_failure', 'cancelled')
  );

-- Archive stuck investigation jobs + replace Captain/AutoCaptain branding
-- in existing DB content that was persisted before the rename.
--
-- Stuck jobs: one-shot investigation jobs that never ran (no runs at all).
-- These have next_fire_at = NULL from a race condition during spawn, leaving
-- the scheduler unable to pick them up. Safe to archive — the scanner will
-- create fresh investigations on the next breach.

UPDATE jobs
SET is_archived = 1,
    is_enabled = 0,
    next_fire_at = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE system_category = 'captain_investigation'
  AND is_archived = 0
  AND id NOT IN (SELECT DISTINCT job_id FROM runs);
--> statement-breakpoint

-- Replace AutoCaptain branding in stored job descriptions and prompts.
UPDATE jobs
SET description = REPLACE(description, 'AutoCaptain', 'Autopilot'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE description LIKE '%AutoCaptain%' OR description LIKE '%Captain Rules%' OR description LIKE '%Captain Metrics%';
--> statement-breakpoint

UPDATE jobs
SET description = REPLACE(REPLACE(description, 'Captain Rules', 'Autopilot Rules'), 'Captain Metrics', 'Autopilot Metrics'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE description LIKE '%Captain Rules%' OR description LIKE '%Captain Metrics%';
--> statement-breakpoint

UPDATE jobs
SET prompt = REPLACE(REPLACE(REPLACE(prompt, 'AutoCaptain', 'Autopilot'), 'Captain Rules', 'Autopilot Rules'), 'Captain Metrics', 'Autopilot Metrics'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE prompt LIKE '%AutoCaptain%' OR prompt LIKE '%Captain Rules%' OR prompt LIKE '%Captain Metrics%';
--> statement-breakpoint

-- Replace in data_table descriptions.
UPDATE data_tables
SET description = REPLACE(description, 'AutoCaptain', 'Autopilot'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE description LIKE '%AutoCaptain%';
--> statement-breakpoint

-- Replace in inbox_items.
UPDATE inbox_items
SET title = REPLACE(REPLACE(title, 'AutoCaptain', 'Autopilot'), 'Captain scan', 'Autopilot scan'),
    message = REPLACE(REPLACE(message, 'AutoCaptain', 'Autopilot'), 'Captain Rules', 'Autopilot Rules')
WHERE title LIKE '%Captain%' OR title LIKE '%AutoCaptain%' OR message LIKE '%Captain%' OR message LIKE '%AutoCaptain%';
--> statement-breakpoint

-- Replace in inbox_events.
UPDATE inbox_events
SET title = REPLACE(REPLACE(title, 'AutoCaptain', 'Autopilot'), 'Captain scan', 'Autopilot scan'),
    body = REPLACE(REPLACE(REPLACE(body, 'AutoCaptain', 'Autopilot'), 'Captain Rules', 'Autopilot Rules'), 'Captain Metrics', 'Autopilot Metrics')
WHERE title LIKE '%Captain%' OR title LIKE '%AutoCaptain%' OR body LIKE '%Captain%' OR body LIKE '%AutoCaptain%';

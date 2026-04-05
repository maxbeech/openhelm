-- Fix: deduplicate "Autopilot Maintenance" system goals.
-- A bug caused one duplicate per project per 30-minute scanner tick.
-- Keep the oldest system goal per project; delete duplicates and their children.

-- Step 1: Delete runs under duplicate goals' jobs (CASCADE would handle this,
-- but being explicit avoids surprises with foreign key ordering).
DELETE FROM runs WHERE job_id IN (
  SELECT j.id FROM jobs j
  INNER JOIN goals g ON j.goal_id = g.id
  WHERE g.name = 'Autopilot Maintenance' AND g.is_system = 1
    AND g.id NOT IN (
      SELECT id FROM goals g2
      WHERE g2.name = 'Autopilot Maintenance' AND g2.is_system = 1
      GROUP BY g2.project_id
      HAVING g2.created_at = MIN(g2.created_at)
    )
);
--> statement-breakpoint

-- Step 2: Delete targets under duplicate goals.
DELETE FROM targets WHERE goal_id IN (
  SELECT g.id FROM goals g
  WHERE g.name = 'Autopilot Maintenance' AND g.is_system = 1
    AND g.id NOT IN (
      SELECT id FROM goals g2
      WHERE g2.name = 'Autopilot Maintenance' AND g2.is_system = 1
      GROUP BY g2.project_id
      HAVING g2.created_at = MIN(g2.created_at)
    )
);
--> statement-breakpoint

-- Step 3: Delete jobs under duplicate goals.
DELETE FROM jobs WHERE goal_id IN (
  SELECT g.id FROM goals g
  WHERE g.name = 'Autopilot Maintenance' AND g.is_system = 1
    AND g.id NOT IN (
      SELECT id FROM goals g2
      WHERE g2.name = 'Autopilot Maintenance' AND g2.is_system = 1
      GROUP BY g2.project_id
      HAVING g2.created_at = MIN(g2.created_at)
    )
);
--> statement-breakpoint

-- Step 4: Delete duplicate goals themselves.
DELETE FROM goals
WHERE name = 'Autopilot Maintenance' AND is_system = 1
  AND id NOT IN (
    SELECT id FROM goals g2
    WHERE g2.name = 'Autopilot Maintenance' AND g2.is_system = 1
    GROUP BY g2.project_id
    HAVING g2.created_at = MIN(g2.created_at)
  );
--> statement-breakpoint

-- Step 5: Prevent future duplicates with a partial unique index.
-- Only one system goal with a given name can exist per project.
CREATE UNIQUE INDEX IF NOT EXISTS idx_goals_unique_system_per_project
  ON goals(project_id, name) WHERE is_system = 1;

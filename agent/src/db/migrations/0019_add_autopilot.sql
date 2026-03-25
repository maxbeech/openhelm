-- Add autopilot columns to jobs table
ALTER TABLE `jobs` ADD `source` text NOT NULL DEFAULT 'user';
--> statement-breakpoint
ALTER TABLE `jobs` ADD `system_category` text;
--> statement-breakpoint
-- Autopilot proposals: pending system job proposals for approval_required mode
CREATE TABLE `autopilot_proposals` (
  `id` text PRIMARY KEY NOT NULL,
  `goal_id` text NOT NULL REFERENCES `goals`(`id`) ON DELETE CASCADE,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `status` text NOT NULL DEFAULT 'pending',
  `planned_jobs` text NOT NULL,
  `reason` text NOT NULL,
  `created_at` text NOT NULL,
  `resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_autopilot_proposals_goal` ON `autopilot_proposals` (`goal_id`, `status`);
--> statement-breakpoint
CREATE INDEX `idx_autopilot_proposals_project` ON `autopilot_proposals` (`project_id`, `status`);
--> statement-breakpoint
CREATE INDEX `idx_jobs_source` ON `jobs` (`source`);

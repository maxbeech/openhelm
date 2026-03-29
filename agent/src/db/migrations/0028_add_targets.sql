CREATE TABLE IF NOT EXISTS `targets` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text REFERENCES `goals`(`id`) ON DELETE CASCADE,
	`job_id` text REFERENCES `jobs`(`id`) ON DELETE CASCADE,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
	`data_table_id` text NOT NULL REFERENCES `data_tables`(`id`) ON DELETE CASCADE,
	`column_id` text NOT NULL,
	`target_value` real NOT NULL,
	`direction` text NOT NULL DEFAULT 'gte',
	`aggregation` text NOT NULL DEFAULT 'latest',
	`label` text,
	`deadline` text,
	`created_by` text NOT NULL DEFAULT 'user',
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_targets_goal` ON `targets` (`goal_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_targets_job` ON `targets` (`job_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_targets_project` ON `targets` (`project_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_targets_table` ON `targets` (`data_table_id`);

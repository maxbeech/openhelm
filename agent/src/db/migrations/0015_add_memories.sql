CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
	`goal_id` text REFERENCES `goals`(`id`) ON DELETE SET NULL,
	`job_id` text REFERENCES `jobs`(`id`) ON DELETE SET NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`importance` integer NOT NULL DEFAULT 5,
	`access_count` integer NOT NULL DEFAULT 0,
	`last_accessed_at` text,
	`tags` text NOT NULL DEFAULT '[]',
	`embedding` text,
	`is_archived` integer NOT NULL DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE TABLE `run_memories` (
	`run_id` text NOT NULL REFERENCES `runs`(`id`) ON DELETE CASCADE,
	`memory_id` text NOT NULL REFERENCES `memories`(`id`) ON DELETE CASCADE,
	PRIMARY KEY (`run_id`, `memory_id`)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_memories_project` ON `memories` (`project_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_memories_goal` ON `memories` (`goal_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_memories_job` ON `memories` (`job_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_memories_type` ON `memories` (`type`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_memories_archived` ON `memories` (`is_archived`);

CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`channel` text DEFAULT 'app' NOT NULL,
	`title` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_calls` text,
	`tool_results` text,
	`pending_actions` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_goals`("id", "project_id", "name", "description", "status", "created_at", "updated_at") SELECT "id", "project_id", '' as "name", "description", "status", "created_at", "updated_at" FROM `goals`;--> statement-breakpoint
DROP TABLE `goals`;--> statement-breakpoint
ALTER TABLE `__new_goals` RENAME TO `goals`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`prompt` text NOT NULL,
	`schedule_type` text NOT NULL,
	`schedule_config` text NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`working_directory` text,
	`next_fire_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "goal_id", "project_id", "name", "description", "prompt", "schedule_type", "schedule_config", "is_enabled", "is_archived", "working_directory", "next_fire_at", "created_at", "updated_at") SELECT "id", "goal_id", "project_id", "name", "description", "prompt", "schedule_type", "schedule_config", "is_enabled", "is_archived", "working_directory", "next_fire_at", "created_at", "updated_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
CREATE INDEX `idx_conversations_project` ON `conversations` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_messages_conversation` ON `messages` (`conversation_id`);
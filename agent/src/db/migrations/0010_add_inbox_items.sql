CREATE TABLE `inbox_items` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL REFERENCES `runs`(`id`) ON DELETE CASCADE,
	`job_id` text NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
	`type` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text
);

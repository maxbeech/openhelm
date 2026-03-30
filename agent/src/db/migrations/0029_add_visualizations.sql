CREATE TABLE IF NOT EXISTS `visualizations` (
    `id` text PRIMARY KEY NOT NULL,
    `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
    `goal_id` text REFERENCES `goals`(`id`) ON DELETE SET NULL,
    `job_id` text REFERENCES `jobs`(`id`) ON DELETE SET NULL,
    `data_table_id` text NOT NULL REFERENCES `data_tables`(`id`) ON DELETE CASCADE,
    `name` text NOT NULL,
    `chart_type` text NOT NULL DEFAULT 'line',
    `config` text NOT NULL DEFAULT '{}',
    `status` text NOT NULL DEFAULT 'active',
    `source` text NOT NULL DEFAULT 'user',
    `sort_order` integer NOT NULL DEFAULT 0,
    `created_at` text NOT NULL,
    `updated_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_viz_project` ON `visualizations` (`project_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_viz_goal` ON `visualizations` (`goal_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_viz_job` ON `visualizations` (`job_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_viz_table` ON `visualizations` (`data_table_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_viz_status` ON `visualizations` (`status`);

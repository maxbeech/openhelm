CREATE TABLE IF NOT EXISTS `claude_usage_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL UNIQUE,
	`recorded_at` text NOT NULL,
	`total_input_tokens` integer NOT NULL DEFAULT 0,
	`total_output_tokens` integer NOT NULL DEFAULT 0,
	`sonnet_input_tokens` integer NOT NULL DEFAULT 0,
	`sonnet_output_tokens` integer NOT NULL DEFAULT 0,
	`openhelm_input_tokens` integer NOT NULL DEFAULT 0,
	`openhelm_output_tokens` integer NOT NULL DEFAULT 0
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_usage_snapshots_date` ON `claude_usage_snapshots` (`date`);

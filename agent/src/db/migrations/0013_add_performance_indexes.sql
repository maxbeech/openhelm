CREATE INDEX IF NOT EXISTS idx_jobs_enabled_fire ON jobs(is_enabled, next_fire_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_runs_job ON runs(job_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(parent_run_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_goals_project ON goals(project_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_inbox_project_status ON inbox_items(project_id, status);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_run_logs_run_seq ON run_logs(run_id, sequence);

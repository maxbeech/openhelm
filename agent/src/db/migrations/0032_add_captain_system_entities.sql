-- AutoCaptain: add is_system flag to goals and data_tables
-- System entities cannot be deleted by users and are hidden by default.
ALTER TABLE goals ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE data_tables ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;

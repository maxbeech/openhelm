-- Add parent_id column for goal hierarchy (unlimited nesting depth)
ALTER TABLE goals ADD COLUMN parent_id TEXT REFERENCES goals(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX idx_goals_parent_id ON goals(parent_id);

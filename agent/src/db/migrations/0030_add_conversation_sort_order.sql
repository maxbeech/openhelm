-- Add sort_order to conversations for user-controlled thread ordering
ALTER TABLE conversations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

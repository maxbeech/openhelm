ALTER TABLE `jobs` RENAME COLUMN `post_prompt` TO `correction_note`;
--> statement-breakpoint
ALTER TABLE `runs` RENAME COLUMN `correction_context` TO `correction_note`;

-- Many-to-many: a credential can be bound to multiple projects, goals, or jobs.
-- Previously a credential could only have ONE scope (scope_type + scope_id on the credentials row).
-- The old columns remain and are still used for global/legacy credentials; this table is additive.
CREATE TABLE `credential_scope_bindings` (
  `credential_id` text NOT NULL REFERENCES `credentials`(`id`) ON DELETE CASCADE,
  `scope_type`    text NOT NULL,
  `scope_id`      text NOT NULL,
  PRIMARY KEY (`credential_id`, `scope_type`, `scope_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_csb_scope` ON `credential_scope_bindings` (`scope_type`, `scope_id`);
--> statement-breakpoint
-- Migrate existing non-global single-scope credentials into the new bindings table
INSERT OR IGNORE INTO `credential_scope_bindings` (`credential_id`, `scope_type`, `scope_id`)
SELECT `id`, `scope_type`, `scope_id`
FROM `credentials`
WHERE `scope_type` != 'global' AND `scope_id` IS NOT NULL;

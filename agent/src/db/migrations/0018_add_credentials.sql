-- Credentials store: metadata only (secret values live in macOS Keychain)
-- type: 'token' | 'username_password'
-- env_var_name: auto-generated from credential name, e.g. OPENHELM_GITHUB_TOKEN
-- allow_prompt_injection: 0 = env var only (default), 1 = also inject into prompt context
CREATE TABLE `credentials` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `type` text NOT NULL,
  `env_var_name` text NOT NULL,
  `allow_prompt_injection` integer NOT NULL DEFAULT 0,
  `scope_type` text NOT NULL DEFAULT 'global',
  `scope_id` text,
  `is_enabled` integer NOT NULL DEFAULT 1,
  `last_used_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_credentials_scope` ON `credentials` (`scope_type`, `scope_id`);
--> statement-breakpoint
CREATE INDEX `idx_credentials_enabled` ON `credentials` (`is_enabled`);
--> statement-breakpoint
CREATE TABLE `run_credentials` (
  `run_id` text NOT NULL REFERENCES `runs`(`id`) ON DELETE CASCADE,
  `credential_id` text NOT NULL REFERENCES `credentials`(`id`) ON DELETE CASCADE,
  `injection_method` text NOT NULL,
  PRIMARY KEY (`run_id`, `credential_id`, `injection_method`)
);

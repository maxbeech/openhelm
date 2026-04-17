-- Migration 0045: Plain text connections always prompt-inject.
-- Per plan 14c: the plain_text type exists for cases where no safer option
-- applies; its semantic is "store as securely as possible, but inject into
-- the prompt on use" (high risk, but explicit).
--
-- Existing plain_text rows with allow_browser_injection=1 were using the old
-- credential model as a form-filler for browser logins. Under the new model
-- that use case belongs to the `browser` type (cookie-capture sessions).
-- Convert them so the flag isn't silently dropped.

UPDATE connections
SET
  type = 'browser',
  allow_prompt_injection = 0,
  env_var_name = ''
WHERE type = 'plain_text' AND allow_browser_injection = 1;

-- Remaining plain_text rows become prompt-only.
UPDATE connections
SET
  allow_prompt_injection = 1,
  allow_browser_injection = 0,
  env_var_name = ''
WHERE type = 'plain_text';

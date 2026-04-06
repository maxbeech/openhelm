-- Add 'browser' to the run_credentials injection_method CHECK constraint.
-- The original migration (0021) predates browser credential injection and
-- only allowed ('env', 'prompt'). The Drizzle schema and executor code
-- already use 'browser' but the DB constraint rejects it, silently breaking
-- the credential audit trail for any run that uses browser-injected credentials.

CREATE TABLE run_credentials_new (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  injection_method TEXT NOT NULL CHECK(injection_method IN ('env', 'prompt', 'browser')),
  PRIMARY KEY (run_id, credential_id, injection_method)
);

INSERT OR IGNORE INTO run_credentials_new SELECT * FROM run_credentials;

DROP TABLE run_credentials;

ALTER TABLE run_credentials_new RENAME TO run_credentials;

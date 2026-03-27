-- Recreate run_credentials with a composite primary key to prevent duplicate audit rows.
-- SQLite does not support ADD CONSTRAINT, so we must recreate the table.
CREATE TABLE run_credentials_new (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  injection_method TEXT NOT NULL CHECK(injection_method IN ('env', 'prompt')),
  PRIMARY KEY (run_id, credential_id, injection_method)
);
INSERT OR IGNORE INTO run_credentials_new SELECT * FROM run_credentials;
DROP TABLE run_credentials;
ALTER TABLE run_credentials_new RENAME TO run_credentials;

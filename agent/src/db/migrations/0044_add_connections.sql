-- Migration 0044: Rename Credentials → Connections
-- Creates new polymorphic connections/connection_scope_bindings/run_connections tables,
-- data-migrates all existing credentials rows, then drops the old tables.
-- Done in a single migration so no intermediate state with both sets of tables exists.

-- ─── 1. Create new tables ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- type discriminator: folder | mcp | cli | browser | token | plain_text | virtual_employee (future)
  type TEXT NOT NULL CHECK(type IN ('folder','mcp','cli','browser','token','plain_text','virtual_employee')),
  -- Auto-generated from name, e.g. OPENHELM_GITHUB_TOKEN. Nullable for folder/mcp/cli types.
  env_var_name TEXT NOT NULL DEFAULT '',
  -- When true, value is also injected into prompt context (token/plain_text only)
  allow_prompt_injection INTEGER NOT NULL DEFAULT 0,
  -- When true, credential is injected directly into the browser MCP (browser type only)
  allow_browser_injection INTEGER NOT NULL DEFAULT 0,
  -- Named persistent Chrome profile (browser type only)
  browser_profile_name TEXT,
  -- install status for mcp/cli types; not_applicable for others
  install_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK(install_status IN ('not_applicable','pending','installing','installed','failed')),
  install_error TEXT,
  -- auth status (unauthenticated → authenticated → expired → revoked)
  auth_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK(auth_status IN ('not_applicable','unauthenticated','authenticated','expired','revoked')),
  -- OAuth access token expiry for background refresh
  oauth_token_expires_at TEXT,
  -- Opaque pointer to secret store: 'keychain:<id>' locally, 'supabase_vault:<uuid>' in cloud
  secret_ref TEXT NOT NULL DEFAULT '',
  -- Type-specific config blob (JSON object, shape varies by type)
  config TEXT NOT NULL DEFAULT '{}',
  -- Whether this connection can be deleted (false for primary folder connections)
  is_deletable INTEGER NOT NULL DEFAULT 1,
  -- Legacy scope fields (kept for compatibility with resolveConnectionsForJob)
  scope_type TEXT NOT NULL DEFAULT 'global' CHECK(scope_type IN ('global','project','goal','job')),
  scope_id TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connection_scope_bindings (
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('project','goal','job')),
  scope_id TEXT NOT NULL,
  PRIMARY KEY (connection_id, scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS run_connections (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  injection_method TEXT NOT NULL CHECK(injection_method IN ('env','prompt','browser','mcp','cli_auth_file','folder_path','oauth_token')),
  PRIMARY KEY (run_id, connection_id, injection_method)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_connections_type ON connections(type);
CREATE INDEX IF NOT EXISTS idx_connections_scope ON connections(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_connections_enabled ON connections(is_enabled);

-- ─── 2. Data migration: credentials → connections ─────────────────────────────

INSERT INTO connections (
  id, name, type, env_var_name,
  allow_prompt_injection, allow_browser_injection, browser_profile_name,
  install_status, auth_status,
  secret_ref, config, is_deletable,
  scope_type, scope_id, is_enabled, last_used_at, created_at, updated_at
)
SELECT
  id,
  name,
  -- Map old (type, injection flags) → new single type
  CASE
    WHEN allow_browser_injection = 1 THEN 'browser'
    WHEN type = 'username_password' THEN 'plain_text'
    ELSE 'token'
  END AS new_type,
  env_var_name,
  allow_prompt_injection,
  allow_browser_injection,
  browser_profile_name,
  'not_applicable' AS install_status,
  CASE
    WHEN allow_browser_injection = 1 THEN
      CASE WHEN browser_profile_name IS NOT NULL THEN 'authenticated' ELSE 'unauthenticated' END
    ELSE 'not_applicable'
  END AS auth_status,
  'keychain:' || id AS secret_ref,
  CASE
    WHEN allow_browser_injection = 1 THEN
      json_object('loginUrl', NULL)
    ELSE
      json_object()
  END AS config,
  1 AS is_deletable,
  scope_type,
  scope_id,
  is_enabled,
  last_used_at,
  created_at,
  updated_at
FROM credentials;

-- Migrate scope bindings
INSERT INTO connection_scope_bindings (connection_id, scope_type, scope_id)
SELECT credential_id, scope_type, scope_id
FROM credential_scope_bindings;

-- Migrate run audit trail (only rows where the credential still exists after migration)
INSERT INTO run_connections (run_id, connection_id, injection_method)
SELECT run_id, credential_id, injection_method
FROM run_credentials
WHERE credential_id IN (SELECT id FROM connections);

-- ─── 3. Auto-create primary folder connections for all existing projects ──────
-- Each project gets a non-deletable "folder" connection representing its directory.

INSERT INTO connections (
  id, name, type, env_var_name,
  install_status, auth_status, secret_ref, config, is_deletable,
  scope_type, scope_id, is_enabled, created_at, updated_at
)
SELECT
  lower(hex(randomblob(16))),
  p.name || ' (folder)',
  'folder',
  '',
  'not_applicable',
  'not_applicable',
  '',
  json_object('path', p.directory_path, 'isPrimary', json('true'), 'projectId', p.id),
  0,
  'project',
  p.id,
  1,
  p.created_at,
  p.created_at
FROM projects p
-- Only create if not already exists (idempotency)
WHERE NOT EXISTS (
  SELECT 1 FROM connections c
  WHERE c.type = 'folder'
    AND c.scope_type = 'project'
    AND c.scope_id = p.id
    AND json_extract(c.config, '$.isPrimary') = 1
);

-- ─── 4. Drop old tables ───────────────────────────────────────────────────────

DROP TABLE IF EXISTS run_credentials;
DROP TABLE IF EXISTS credential_scope_bindings;
DROP TABLE IF EXISTS credentials;

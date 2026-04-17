-- Migration: Credentials → Connections overhaul (Postgres mirror of SQLite 0044/0045)
--
-- 1. Enable Supabase Vault extension (preinstalled on hosted projects; guard is idempotent).
-- 2. Create connections, connection_scope_bindings, run_connections tables.
-- 3. Add SECURITY DEFINER RPCs for Vault read/write (per-user ownership enforced server-side).
-- 4. Copy data from credentials → connections (secret values moved into Vault inline).
-- 5. Drop old credentials*, run_credentials tables.

-- ─── 1. Vault extension ───────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "supabase_vault" SCHEMA vault;

-- ─── 2. New tables ────────────────────────────────────────────────────────────

CREATE TABLE connections (
  id                        TEXT PRIMARY KEY,
  user_id                   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                      TEXT NOT NULL,
  type                      TEXT NOT NULL
                              CHECK(type IN ('folder','mcp','cli','browser','token','plain_text','virtual_employee')),
  env_var_name              TEXT NOT NULL DEFAULT '',
  allow_prompt_injection    BOOLEAN NOT NULL DEFAULT false,
  allow_browser_injection   BOOLEAN NOT NULL DEFAULT false,
  browser_profile_name      TEXT,
  browser_profile_storage_key TEXT,
  browser_profile_verified_at TIMESTAMPTZ,
  install_status            TEXT NOT NULL DEFAULT 'not_applicable'
                              CHECK(install_status IN ('not_applicable','pending','installing','installed','failed')),
  install_error             TEXT,
  auth_status               TEXT NOT NULL DEFAULT 'not_applicable'
                              CHECK(auth_status IN ('not_applicable','unauthenticated','authenticated','expired','revoked')),
  oauth_token_expires_at    TIMESTAMPTZ,
  -- Opaque secret pointer: 'supabase_vault:<uuid>' in cloud, 'keychain:<id>' locally
  secret_ref                TEXT NOT NULL DEFAULT '',
  -- Per-type JSON config blob (folder, mcp, cli, browser configs)
  config                    JSONB NOT NULL DEFAULT '{}',
  -- false for primary folder connections (not deletable)
  is_deletable              BOOLEAN NOT NULL DEFAULT true,
  -- Legacy single-scope fields (kept for resolveConnectionsForJob compatibility)
  scope_type                TEXT NOT NULL DEFAULT 'global'
                              CHECK(scope_type IN ('global','project','goal','job')),
  scope_id                  TEXT,
  is_enabled                BOOLEAN NOT NULL DEFAULT true,
  last_used_at              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE connection_scope_bindings (
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  scope_type    TEXT NOT NULL CHECK(scope_type IN ('project','goal','job')),
  scope_id      TEXT NOT NULL,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (connection_id, scope_type, scope_id)
);

CREATE TABLE run_connections (
  run_id           TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  connection_id    TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  injection_method TEXT NOT NULL
                     CHECK(injection_method IN ('env','prompt','browser','mcp','cli_auth_file','folder_path','oauth_token')),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (run_id, connection_id, injection_method)
);

-- Indexes
CREATE INDEX idx_connections_user  ON connections(user_id);
CREATE INDEX idx_connections_type  ON connections(type);
CREATE INDEX idx_connections_scope ON connections(scope_type, scope_id);
-- Partial unique: one primary folder per project scope
CREATE UNIQUE INDEX idx_connections_primary_folder
  ON connections(user_id, scope_type, scope_id)
  WHERE type = 'folder' AND (config->>'isPrimary')::bool;

-- ─── 3. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE connections             ENABLE ROW LEVEL SECURITY;
ALTER TABLE connection_scope_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_connections         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "connections_select" ON connections FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "connections_all"    ON connections FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "connection_scope_bindings_select" ON connection_scope_bindings FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "connection_scope_bindings_all"    ON connection_scope_bindings FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "run_connections_select" ON run_connections FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "run_connections_all"    ON run_connections FOR ALL    USING (user_id = auth.uid());

-- ─── 4. Vault RPCs (SECURITY DEFINER — ownership checked before secret access) ──

-- Create or replace a secret in Vault for a connection the caller owns.
-- Returns the Vault secret UUID (stored in connections.secret_ref).
CREATE OR REPLACE FUNCTION vault_create_connection_secret(
  p_connection_id TEXT,
  p_secret        TEXT
) RETURNS UUID
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, vault
AS $$
DECLARE
  v_user_id UUID;
  v_secret_id UUID;
  v_name TEXT;
BEGIN
  -- Verify ownership
  SELECT user_id INTO v_user_id FROM connections WHERE id = p_connection_id;
  IF v_user_id IS NULL OR v_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'connection not found or not owned by caller';
  END IF;

  v_name := 'openhelm_conn_' || p_connection_id;

  -- Upsert: if a secret with this name exists, update it; otherwise create
  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_name;
  IF v_secret_id IS NOT NULL THEN
    UPDATE vault.secrets SET secret = p_secret WHERE id = v_secret_id;
  ELSE
    v_secret_id := vault.create_secret(p_secret, v_name, 'OpenHelm connection secret');
  END IF;

  -- Stamp the ref back onto the connections row
  UPDATE connections
    SET secret_ref = 'supabase_vault:' || v_secret_id::TEXT,
        updated_at  = NOW()
    WHERE id = p_connection_id;

  RETURN v_secret_id;
END;
$$;

-- Read a secret from Vault for a connection the caller owns.
-- Returns the decrypted plaintext, or NULL if not found.
CREATE OR REPLACE FUNCTION vault_read_connection_secret(
  p_connection_id TEXT
) RETURNS TEXT
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, vault
AS $$
DECLARE
  v_user_id   UUID;
  v_secret_ref TEXT;
  v_secret_id  UUID;
  v_plaintext  TEXT;
BEGIN
  SELECT user_id, secret_ref INTO v_user_id, v_secret_ref
    FROM connections WHERE id = p_connection_id;

  IF v_user_id IS NULL OR v_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'connection not found or not owned by caller';
  END IF;

  IF v_secret_ref IS NULL OR NOT v_secret_ref LIKE 'supabase_vault:%' THEN
    RETURN NULL;
  END IF;

  v_secret_id := (SPLIT_PART(v_secret_ref, ':', 2))::UUID;
  SELECT decrypted_secret INTO v_plaintext
    FROM vault.decrypted_secrets WHERE id = v_secret_id;

  RETURN v_plaintext;
END;
$$;

-- Delete a Vault secret for a connection the caller owns.
CREATE OR REPLACE FUNCTION vault_delete_connection_secret(
  p_connection_id TEXT
) RETURNS VOID
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, vault
AS $$
DECLARE
  v_user_id    UUID;
  v_secret_ref TEXT;
  v_secret_id  UUID;
BEGIN
  SELECT user_id, secret_ref INTO v_user_id, v_secret_ref
    FROM connections WHERE id = p_connection_id;

  IF v_user_id IS NULL OR v_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'connection not found or not owned by caller';
  END IF;

  IF v_secret_ref LIKE 'supabase_vault:%' THEN
    v_secret_id := (SPLIT_PART(v_secret_ref, ':', 2))::UUID;
    DELETE FROM vault.secrets WHERE id = v_secret_id;
    UPDATE connections SET secret_ref = '', updated_at = NOW() WHERE id = p_connection_id;
  END IF;
END;
$$;

-- ─── 5. Data migration: credentials → connections ────────────────────────────

-- Copy metadata rows (secrets handled below via Vault)
INSERT INTO connections (
  id, user_id, name, type, env_var_name,
  allow_prompt_injection, allow_browser_injection,
  browser_profile_name, browser_profile_storage_key, browser_profile_verified_at,
  install_status, auth_status, secret_ref, config, is_deletable,
  scope_type, scope_id, is_enabled, last_used_at, created_at, updated_at
)
SELECT
  id,
  user_id,
  name,
  CASE
    WHEN allow_browser_injection THEN 'browser'
    WHEN type = 'username_password' THEN 'plain_text'
    ELSE 'token'
  END,
  env_var_name,
  allow_prompt_injection,
  allow_browser_injection,
  browser_profile_name,
  browser_profile_storage_key,
  browser_profile_verified_at,
  'not_applicable',
  CASE
    WHEN allow_browser_injection THEN
      CASE WHEN browser_profile_name IS NOT NULL THEN 'authenticated' ELSE 'unauthenticated' END
    ELSE 'not_applicable'
  END,
  '',  -- secret_ref set below after Vault migration
  '{}',
  true,
  scope_type,
  scope_id,
  is_enabled,
  last_used_at,
  created_at,
  updated_at
FROM credentials;

-- Migrate secrets into Vault for credentials that have a plaintext secret_value
-- (worker used to store the raw value in a secret_value column via the old schema)
DO $$
DECLARE
  r RECORD;
  v_id UUID;
BEGIN
  FOR r IN
    SELECT c.id, c.user_id, cr.secret_value
    FROM connections c
    JOIN credentials cr ON cr.id = c.id
    WHERE cr.secret_value IS NOT NULL AND cr.secret_value <> ''
  LOOP
    BEGIN
      v_id := vault.create_secret(r.secret_value, 'openhelm_conn_' || r.id, 'migrated from credentials');
      UPDATE connections
        SET secret_ref  = 'supabase_vault:' || v_id::TEXT,
            updated_at  = NOW()
        WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      -- Non-fatal: log and continue so one bad row doesn't abort the migration
      RAISE WARNING 'vault migration failed for connection %: %', r.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- Copy scope bindings
INSERT INTO connection_scope_bindings (connection_id, scope_type, scope_id, user_id)
SELECT credential_id, scope_type, scope_id, user_id
FROM credential_scope_bindings;

-- Copy run audit trail
INSERT INTO run_connections (run_id, connection_id, injection_method, user_id)
SELECT run_id, credential_id, injection_method, user_id
FROM run_credentials
WHERE credential_id IN (SELECT id FROM connections);

-- ─── 6. Drop old tables ───────────────────────────────────────────────────────

DROP TABLE run_credentials CASCADE;
DROP TABLE credential_scope_bindings CASCADE;
DROP TABLE credentials CASCADE;

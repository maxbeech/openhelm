-- ============================================================
-- OpenHelm — Business Tier License Keys
--
-- License keys are issued to Business plan subscribers and
-- validated by the local desktop app on startup.
-- Applied via: Supabase MCP (apply_migration)
-- ============================================================

CREATE TABLE license_keys (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key                 TEXT NOT NULL UNIQUE,            -- opaque token, ~32 chars
  stripe_customer_id  TEXT NOT NULL,
  email               TEXT NOT NULL,
  plan                TEXT NOT NULL DEFAULT 'business', -- 'business'
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'revoked', 'expired')),
  max_seats           INTEGER NOT NULL DEFAULT 10,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ,                     -- null = no expiry
  revoked_at          TIMESTAMPTZ
);

CREATE INDEX idx_license_keys_key ON license_keys(key);
CREATE INDEX idx_license_keys_customer ON license_keys(stripe_customer_id);

-- Service role only — license keys are never exposed to clients via RLS
ALTER TABLE license_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON license_keys
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Function: validate a license key and return seat info
CREATE OR REPLACE FUNCTION validate_license_key(p_key TEXT)
RETURNS TABLE (
  valid         BOOLEAN,
  plan          TEXT,
  status        TEXT,
  max_seats     INTEGER,
  email         TEXT,
  expires_at    TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    (lk.status = 'active' AND (lk.expires_at IS NULL OR lk.expires_at > now())) AS valid,
    lk.plan,
    lk.status,
    lk.max_seats,
    lk.email,
    lk.expires_at
  FROM license_keys lk
  WHERE lk.key = p_key;

  -- Return invalid row if key not found
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'none'::TEXT, 'not_found'::TEXT, 0, ''::TEXT, NULL::TIMESTAMPTZ;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION validate_license_key(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION validate_license_key(TEXT) TO service_role, authenticated, anon;
-- anon granted so the desktop app can validate without being logged in to Supabase

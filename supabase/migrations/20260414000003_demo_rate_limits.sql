-- ============================================================
-- Plan 13 — Demo chat rate limiting
--
-- Tracks per-session message counts and a global daily USD budget.
-- Only the worker (service_role) reads/writes these tables — RLS is
-- intentionally left disabled since no user JWT should ever touch them.
-- ============================================================

CREATE TABLE IF NOT EXISTS demo_rate_limits (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID        NOT NULL,    -- = auth.uid() of the anon user
  ip_hash       TEXT        NOT NULL,    -- sha256(X-Forwarded-For || secret)
  slug          TEXT        NOT NULL,
  messages_sent INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_demo_rate_limits_ip
  ON demo_rate_limits(ip_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS demo_daily_budget (
  day            DATE          PRIMARY KEY,
  cost_usd       NUMERIC(10,4) NOT NULL DEFAULT 0,
  message_count  INTEGER       NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Atomic increment helpers — avoid read-modify-write races under
-- concurrent demo chat traffic.

CREATE OR REPLACE FUNCTION increment_demo_session(
  p_session_id UUID,
  p_ip_hash    TEXT,
  p_slug       TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_count INTEGER;
BEGIN
  INSERT INTO demo_rate_limits (session_id, ip_hash, slug, messages_sent)
  VALUES (p_session_id, p_ip_hash, p_slug, 1)
  ON CONFLICT (session_id, slug) DO UPDATE
    SET messages_sent = demo_rate_limits.messages_sent + 1,
        updated_at    = now()
  RETURNING messages_sent INTO new_count;
  RETURN new_count;
END;
$$;

CREATE OR REPLACE FUNCTION increment_demo_budget(
  p_day      DATE,
  p_cost_usd NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_cost NUMERIC;
BEGIN
  INSERT INTO demo_daily_budget (day, cost_usd, message_count)
  VALUES (p_day, p_cost_usd, 1)
  ON CONFLICT (day) DO UPDATE
    SET cost_usd      = demo_daily_budget.cost_usd + p_cost_usd,
        message_count = demo_daily_budget.message_count + 1,
        updated_at    = now()
  RETURNING cost_usd INTO new_cost;
  RETURN new_cost;
END;
$$;

REVOKE ALL ON FUNCTION increment_demo_session(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_demo_budget(DATE, NUMERIC)    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_demo_session(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION increment_demo_budget(DATE, NUMERIC)    TO service_role;

-- ============================================================
-- OpenHelm Cloud — RPC Helper Functions
-- ============================================================

-- Atomically increment a user's used_token_credits in the subscriptions table.
-- Called by the Worker after every LLM operation.
-- Uses service_role context (no RLS check needed here).
CREATE OR REPLACE FUNCTION increment_used_credits(
  p_user_id UUID,
  p_amount   BIGINT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE subscriptions
  SET
    used_token_credits = used_token_credits + p_amount,
    updated_at = now()
  WHERE user_id = p_user_id
    AND status = 'active';
  -- No-op if user has no active subscription (free tier / lapsed)
END;
$$;

-- Returns a user's current billing period usage summary.
-- Used by the usage-report Edge Function.
CREATE OR REPLACE FUNCTION get_usage_summary(p_user_id UUID)
RETURNS TABLE (
  call_type       TEXT,
  model           TEXT,
  input_tokens    BIGINT,
  output_tokens   BIGINT,
  billed_cost_usd NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    ur.call_type,
    ur.model,
    COALESCE(SUM(ur.input_tokens),  0)::BIGINT AS input_tokens,
    COALESCE(SUM(ur.output_tokens), 0)::BIGINT AS output_tokens,
    COALESCE(SUM(ur.billed_cost_usd), 0)       AS billed_cost_usd
  FROM usage_records ur
  JOIN subscriptions s ON s.user_id = ur.user_id
  WHERE ur.user_id = p_user_id
    AND ur.created_at >= s.current_period_start
    AND ur.created_at <  s.current_period_end
  GROUP BY ur.call_type, ur.model;
$$;

-- Revoke public execute and grant only to service_role + authenticated
REVOKE ALL ON FUNCTION increment_used_credits(UUID, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_used_credits(UUID, BIGINT) TO service_role;

REVOKE ALL ON FUNCTION get_usage_summary(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_usage_summary(UUID) TO service_role, authenticated;

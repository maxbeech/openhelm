-- ============================================================
-- Plan 13b — Cloud voice chat via OpenAI Realtime API
--
-- voice_sessions      one row per Realtime session; accumulates usage and
--                     links back to the conversation the voice turn belongs to.
-- messages            adds voice_session_id FK so voice turns show up in the
--                     same thread as typed turns.
-- usage_records       extends call_type CHECK to allow voice_input/voice_output.
-- demo_rate_limits    adds voice_seconds for per-session budget tracking +
--                     increment RPC. Budget is 60 seconds per session/IP.
-- ============================================================

CREATE TABLE IF NOT EXISTS voice_sessions (
  id                          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id             TEXT          REFERENCES conversations(id) ON DELETE SET NULL,
  model                       TEXT          NOT NULL
                                 CHECK (model IN ('gpt-realtime-mini','gpt-realtime')),
  voice                       TEXT          NOT NULL,
  permission_mode             TEXT          NOT NULL,
  status                      TEXT          NOT NULL DEFAULT 'active'
                                 CHECK (status IN ('active','ended','errored')),
  started_at                  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  ended_at                    TIMESTAMPTZ,
  openai_session_id           TEXT,
  total_input_audio_tokens    INTEGER       NOT NULL DEFAULT 0,
  total_output_audio_tokens   INTEGER       NOT NULL DEFAULT 0,
  total_cached_input_tokens   INTEGER       NOT NULL DEFAULT 0,
  total_input_text_tokens     INTEGER       NOT NULL DEFAULT 0,
  total_output_text_tokens    INTEGER       NOT NULL DEFAULT 0,
  total_cost_usd              NUMERIC(10,6) NOT NULL DEFAULT 0,
  total_billed_usd            NUMERIC(10,6) NOT NULL DEFAULT 0,
  tool_call_count             INTEGER       NOT NULL DEFAULT 0
);

ALTER TABLE voice_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voice_sessions_tenant" ON voice_sessions
  FOR ALL USING (user_id = auth.uid());

CREATE INDEX idx_voice_sessions_user_started
  ON voice_sessions(user_id, started_at DESC);

-- Messages link back to the voice session so the chat thread reflects voice turns.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS voice_session_id UUID
    REFERENCES voice_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_voice_session
  ON messages(voice_session_id)
  WHERE voice_session_id IS NOT NULL;

-- usage_records call_type CHECK — add voice_input / voice_output so the worker
-- can record Realtime audio-token consumption against the existing billing pipe.
ALTER TABLE usage_records DROP CONSTRAINT IF EXISTS usage_records_call_type_check;
ALTER TABLE usage_records ADD CONSTRAINT usage_records_call_type_check
  CHECK (call_type IN ('execution','planning','chat','assessment','voice_input','voice_output'));

-- Demo voice budget — 60 seconds of assistant audio per anonymous session per slug.
-- Stored alongside the existing chat counters so a single row tracks both surfaces.
ALTER TABLE demo_rate_limits
  ADD COLUMN IF NOT EXISTS voice_seconds_used INTEGER NOT NULL DEFAULT 0;

-- Atomic increment RPC used from worker/src/demo-rate-limit.ts after a demo
-- voice session ends. Mirrors increment_demo_session() in structure but
-- records elapsed output audio instead of message count.
CREATE OR REPLACE FUNCTION increment_demo_voice_seconds(
  p_session_id UUID,
  p_ip_hash    TEXT,
  p_slug       TEXT,
  p_seconds    INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_total INTEGER;
BEGIN
  INSERT INTO demo_rate_limits (session_id, ip_hash, slug, voice_seconds_used)
  VALUES (p_session_id, p_ip_hash, p_slug, GREATEST(p_seconds, 0))
  ON CONFLICT (session_id, slug) DO UPDATE
    SET voice_seconds_used = demo_rate_limits.voice_seconds_used + GREATEST(p_seconds, 0),
        updated_at         = now()
  RETURNING voice_seconds_used INTO new_total;
  RETURN new_total;
END;
$$;

REVOKE ALL ON FUNCTION increment_demo_voice_seconds(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_demo_voice_seconds(UUID, TEXT, TEXT, INTEGER) TO service_role;

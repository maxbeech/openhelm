-- ============================================================
-- Plan 13b follow-up — voice session project scope + demo RLS hardening
--
-- 1. voice_sessions gains a nullable project_id so the voice tool handler
--    can default create_goal / create_job / list_goals calls to the user's
--    active project instead of trusting the LLM to remember the id.
--
-- 2. Demo RLS SELECT policies are tightened so demo content is only visible
--    to anonymous visitors. Previously any authenticated user saw every
--    demo project's goals / jobs leaking into their own sidebar.
--
-- Backfills existing voice_sessions.project_id to NULL (the column default)
-- so no session data is lost.
-- ============================================================

-- ── 1. voice_sessions.project_id ────────────────────────────────────
ALTER TABLE voice_sessions
  ADD COLUMN IF NOT EXISTS project_id TEXT
    REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_voice_sessions_project
  ON voice_sessions(project_id)
  WHERE project_id IS NOT NULL;

-- ── 2. Demo RLS hardening ──────────────────────────────────────────
--
-- All *_demo_select policies are re-created so the USING clause requires
-- the caller to be an anonymous Supabase Auth session (is_anonymous claim
-- in the JWT). Authenticated users on their real dashboard therefore see
-- only the rows their own user_id owns — no demo leakage.
--
-- Anonymous demo visitors land on /demo/:slug, sign in via
-- signInAnonymously() (which stamps is_anonymous = true into the JWT),
-- and keep full visibility into the demo project tree.

DROP POLICY IF EXISTS "projects_demo_select"       ON projects;
DROP POLICY IF EXISTS "goals_demo_select"          ON goals;
DROP POLICY IF EXISTS "jobs_demo_select"           ON jobs;
DROP POLICY IF EXISTS "data_tables_demo_select"    ON data_tables;
DROP POLICY IF EXISTS "visualizations_demo_select" ON visualizations;
DROP POLICY IF EXISTS "memories_demo_select"       ON memories;
DROP POLICY IF EXISTS "conversations_demo_select"  ON conversations;
DROP POLICY IF EXISTS "runs_demo_select"           ON runs;
DROP POLICY IF EXISTS "run_logs_demo_select"       ON run_logs;
DROP POLICY IF EXISTS "messages_demo_select"       ON messages;
DROP POLICY IF EXISTS "data_table_rows_demo_select" ON data_table_rows;

-- Helper: a single expression reused by every policy below. COALESCE so a
-- JWT missing the claim falls through to FALSE (most conservative default).
-- The claim value is delivered as a JSON string when set, so compare with
-- the text form 'true'.
CREATE OR REPLACE FUNCTION is_anonymous_caller()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'is_anonymous') = 'true',
    false
  );
$$;

REVOKE ALL ON FUNCTION is_anonymous_caller() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_anonymous_caller() TO anon, authenticated, service_role;

-- projects: anonymous visitors only
CREATE POLICY "projects_demo_select" ON projects
  FOR SELECT USING (is_demo = true AND is_anonymous_caller());

CREATE POLICY "goals_demo_select" ON goals
  FOR SELECT USING (is_demo_project(project_id) AND is_anonymous_caller());

CREATE POLICY "jobs_demo_select" ON jobs
  FOR SELECT USING (is_demo_project(project_id) AND is_anonymous_caller());

CREATE POLICY "data_tables_demo_select" ON data_tables
  FOR SELECT USING (is_demo_project(project_id) AND is_anonymous_caller());

CREATE POLICY "visualizations_demo_select" ON visualizations
  FOR SELECT USING (is_demo_project(project_id) AND is_anonymous_caller());

CREATE POLICY "memories_demo_select" ON memories
  FOR SELECT USING (is_demo_project(project_id) AND is_anonymous_caller());

CREATE POLICY "conversations_demo_select" ON conversations
  FOR SELECT USING (
    project_id IS NOT NULL
    AND is_demo_project(project_id)
    AND is_anonymous_caller()
  );

CREATE POLICY "runs_demo_select" ON runs
  FOR SELECT USING (
    is_anonymous_caller()
    AND EXISTS (
      SELECT 1 FROM jobs
      WHERE jobs.id = runs.job_id
        AND is_demo_project(jobs.project_id)
    )
  );

CREATE POLICY "run_logs_demo_select" ON run_logs
  FOR SELECT USING (
    is_anonymous_caller()
    AND EXISTS (
      SELECT 1 FROM runs
      JOIN jobs ON jobs.id = runs.job_id
      WHERE runs.id = run_logs.run_id
        AND is_demo_project(jobs.project_id)
    )
  );

CREATE POLICY "messages_demo_select" ON messages
  FOR SELECT USING (
    is_anonymous_caller()
    AND EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
        AND conversations.project_id IS NOT NULL
        AND is_demo_project(conversations.project_id)
    )
  );

CREATE POLICY "data_table_rows_demo_select" ON data_table_rows
  FOR SELECT USING (
    is_anonymous_caller()
    AND EXISTS (
      SELECT 1 FROM data_tables
      WHERE data_tables.id = data_table_rows.table_id
        AND is_demo_project(data_tables.project_id)
    )
  );

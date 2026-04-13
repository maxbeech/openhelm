-- ============================================================
-- Plan 13 — Demo RLS SELECT policies
--
-- These are ADDITIVE policies. Postgres RLS OR-combines all policies
-- for the same (role, command). So on `projects` we already have:
--   projects_select: user_id = auth.uid()
-- and we add:
--   projects_demo_select: is_demo = true
-- Together: a user can read their own projects OR any demo project.
--
-- Write policies stay unchanged — anon users can never INSERT/UPDATE/
-- DELETE demo rows because the "*_all" policy requires user_id = auth.uid()
-- and the demo rows are owned by the demo owner user, not the visitor.
-- ============================================================

-- projects: allow reading rows flagged as demos
CREATE POLICY "projects_demo_select" ON projects
  FOR SELECT USING (is_demo = true);

-- Direct project-scoped child tables
CREATE POLICY "goals_demo_select" ON goals
  FOR SELECT USING (is_demo_project(project_id));

CREATE POLICY "jobs_demo_select" ON jobs
  FOR SELECT USING (is_demo_project(project_id));

CREATE POLICY "data_tables_demo_select" ON data_tables
  FOR SELECT USING (is_demo_project(project_id));

CREATE POLICY "visualizations_demo_select" ON visualizations
  FOR SELECT USING (is_demo_project(project_id));

CREATE POLICY "memories_demo_select" ON memories
  FOR SELECT USING (is_demo_project(project_id));

-- conversations.project_id is nullable — only expose project-scoped demos
CREATE POLICY "conversations_demo_select" ON conversations
  FOR SELECT USING (project_id IS NOT NULL AND is_demo_project(project_id));

-- Indirect (two-hop) child tables — join through parent
CREATE POLICY "runs_demo_select" ON runs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM jobs
      WHERE jobs.id = runs.job_id
        AND is_demo_project(jobs.project_id)
    )
  );

CREATE POLICY "run_logs_demo_select" ON run_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM runs
      JOIN jobs ON jobs.id = runs.job_id
      WHERE runs.id = run_logs.run_id
        AND is_demo_project(jobs.project_id)
    )
  );

CREATE POLICY "messages_demo_select" ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
        AND conversations.project_id IS NOT NULL
        AND is_demo_project(conversations.project_id)
    )
  );

CREATE POLICY "data_table_rows_demo_select" ON data_table_rows
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM data_tables
      WHERE data_tables.id = data_table_rows.table_id
        AND is_demo_project(data_tables.project_id)
    )
  );

-- Tables intentionally NOT exposed to demo visitors:
--   settings, credentials, credential_scope_bindings, run_credentials,
--   subscriptions, usage_records, inbox_events, inbox_items,
--   autopilot_proposals, claude_usage_snapshots, run_memories,
--   data_table_changes, targets
-- These contain user-private operational / billing / audit data and have
-- no analog a demo visitor should see.

-- ============================================================
-- Row Level Security — all tables isolated by user_id = auth.uid()
-- The Worker Service bypasses RLS via the service_role key.
-- ============================================================

ALTER TABLE settings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects               ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages               ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories               ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_memories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE autopilot_proposals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE credentials            ENABLE ROW LEVEL SECURITY;
ALTER TABLE credential_scope_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_credentials        ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_tables            ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_table_rows        ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_table_changes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE claude_usage_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE targets                ENABLE ROW LEVEL SECURITY;
ALTER TABLE visualizations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_logs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records          ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions          ENABLE ROW LEVEL SECURITY;

CREATE POLICY "settings_select" ON settings FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "settings_all"    ON settings FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "projects_select" ON projects FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "projects_all"    ON projects FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "goals_select" ON goals FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "goals_all"    ON goals FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "jobs_select" ON jobs FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "jobs_all"    ON jobs FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "runs_select" ON runs FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "runs_all"    ON runs FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "conversations_select" ON conversations FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "conversations_all"    ON conversations FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "messages_select" ON messages FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "messages_all"    ON messages FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "inbox_items_select" ON inbox_items FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "inbox_items_all"    ON inbox_items FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "memories_select" ON memories FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "memories_all"    ON memories FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "run_memories_select" ON run_memories FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "run_memories_all"    ON run_memories FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "autopilot_proposals_select" ON autopilot_proposals FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "autopilot_proposals_all"    ON autopilot_proposals FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "credentials_select" ON credentials FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "credentials_all"    ON credentials FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "credential_scope_bindings_select" ON credential_scope_bindings FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "credential_scope_bindings_all"    ON credential_scope_bindings FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "run_credentials_select" ON run_credentials FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "run_credentials_all"    ON run_credentials FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "data_tables_select" ON data_tables FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "data_tables_all"    ON data_tables FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "data_table_rows_select" ON data_table_rows FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "data_table_rows_all"    ON data_table_rows FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "data_table_changes_select" ON data_table_changes FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "data_table_changes_all"    ON data_table_changes FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "claude_usage_snapshots_select" ON claude_usage_snapshots FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "claude_usage_snapshots_all"    ON claude_usage_snapshots FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "targets_select" ON targets FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "targets_all"    ON targets FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "visualizations_select" ON visualizations FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "visualizations_all"    ON visualizations FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "inbox_events_select" ON inbox_events FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "inbox_events_all"    ON inbox_events FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "run_logs_select" ON run_logs FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "run_logs_all"    ON run_logs FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "usage_records_select" ON usage_records FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "usage_records_all"    ON usage_records FOR ALL    USING (user_id = auth.uid());

CREATE POLICY "subscriptions_select" ON subscriptions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "subscriptions_all"    ON subscriptions FOR ALL    USING (user_id = auth.uid());

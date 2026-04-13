-- ============================================================
-- OpenHelm Cloud — Initial Postgres Schema
-- Mirrors the SQLite schema with Postgres-appropriate types.
-- Every table has user_id (UUID) referencing auth.users for
-- multi-tenant isolation. JSON columns use JSONB.
-- Applied via: Supabase MCP (apply_migration)
-- ============================================================

CREATE TABLE settings (
  user_id     UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key         TEXT    NOT NULL,
  value       TEXT    NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE projects (
  id              TEXT PRIMARY KEY,
  user_id         UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT    NOT NULL,
  description     TEXT,
  directory_path  TEXT    NOT NULL,
  git_url         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE goals (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES goals(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','paused','archived')),
  icon        TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT false,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id                       TEXT PRIMARY KEY,
  user_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_id                  TEXT REFERENCES goals(id) ON DELETE SET NULL,
  project_id               TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  description              TEXT,
  prompt                   TEXT NOT NULL,
  schedule_type            TEXT NOT NULL
                             CHECK (schedule_type IN ('once','interval','cron','calendar','manual')),
  schedule_config          JSONB NOT NULL DEFAULT '{}',
  is_enabled               BOOLEAN NOT NULL DEFAULT true,
  is_archived              BOOLEAN NOT NULL DEFAULT false,
  working_directory        TEXT,
  next_fire_at             TIMESTAMPTZ,
  model                    TEXT NOT NULL DEFAULT 'sonnet',
  model_effort             TEXT NOT NULL DEFAULT 'medium',
  permission_mode          TEXT NOT NULL DEFAULT 'bypassPermissions',
  icon                     TEXT,
  correction_note          TEXT,
  silence_timeout_minutes  INTEGER,
  source                   TEXT NOT NULL DEFAULT 'user',
  system_category          TEXT,
  sort_order               INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE runs (
  id             TEXT PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id         TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('deferred','queued','running','succeeded','failed','permanent_failure','cancelled')),
  trigger_source TEXT NOT NULL
                   CHECK (trigger_source IN ('scheduled','manual','corrective')),
  parent_run_id  TEXT REFERENCES runs(id) ON DELETE SET NULL,
  correction_note TEXT,
  scheduled_for  TIMESTAMPTZ,
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  exit_code      INTEGER,
  summary        TEXT,
  session_id     TEXT,
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id  TEXT REFERENCES projects(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL DEFAULT 'app',
  title       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL
                    CHECK (role IN ('user','assistant','system','tool_result')),
  content         TEXT NOT NULL,
  tool_calls      JSONB,
  tool_results    JSONB,
  pending_actions JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inbox_items (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_id      TEXT REFERENCES runs(id) ON DELETE CASCADE,
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type        TEXT NOT NULL
                CHECK (type IN ('permanent_failure','human_in_loop','autopilot_limit',
                                'captcha_intervention','auth_required','mcp_unavailable','captain_insight')),
  status      TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','resolved','dismissed')),
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE memories (
  id              TEXT PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  goal_id         TEXT REFERENCES goals(id) ON DELETE SET NULL,
  job_id          TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  type            TEXT NOT NULL
                    CHECK (type IN ('semantic','episodic','procedural','source')),
  content         TEXT NOT NULL,
  source_type     TEXT NOT NULL
                    CHECK (source_type IN ('run','goal','job','chat','user','system')),
  source_id       TEXT,
  importance      INTEGER NOT NULL DEFAULT 5,
  access_count    INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMPTZ,
  tags            JSONB NOT NULL DEFAULT '[]',
  embedding       JSONB,
  is_archived     BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE run_memories (
  run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  memory_id   TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (run_id, memory_id)
);

CREATE TABLE autopilot_proposals (
  id           TEXT PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_id      TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','rejected','expired')),
  planned_jobs JSONB NOT NULL,
  reason       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ
);

CREATE TABLE credentials (
  id                      TEXT PRIMARY KEY,
  user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  type                    TEXT NOT NULL CHECK (type IN ('token','username_password')),
  env_var_name            TEXT NOT NULL,
  allow_prompt_injection  BOOLEAN NOT NULL DEFAULT false,
  allow_browser_injection BOOLEAN NOT NULL DEFAULT false,
  browser_profile_name    TEXT,
  scope_type              TEXT NOT NULL DEFAULT 'global'
                            CHECK (scope_type IN ('global','project','goal','job')),
  scope_id                TEXT,
  is_enabled              BOOLEAN NOT NULL DEFAULT true,
  last_used_at            TIMESTAMPTZ,
  -- Cloud-mode secret storage (JSON-serialised CredentialValue, protected by RLS)
  secret_value            TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE credential_scope_bindings (
  credential_id TEXT NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  scope_type    TEXT NOT NULL CHECK (scope_type IN ('project','goal','job')),
  scope_id      TEXT NOT NULL,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (credential_id, scope_type, scope_id)
);

CREATE TABLE run_credentials (
  run_id            TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  credential_id     TEXT NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  injection_method  TEXT NOT NULL CHECK (injection_method IN ('env','prompt','browser')),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (run_id, credential_id, injection_method)
);

CREATE TABLE data_tables (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  columns     JSONB NOT NULL DEFAULT '[]',
  embedding   JSONB,
  row_count   INTEGER NOT NULL DEFAULT 0,
  is_system   BOOLEAN NOT NULL DEFAULT false,
  created_by  TEXT NOT NULL DEFAULT 'user' CHECK (created_by IN ('user','ai')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE data_table_rows (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  table_id    TEXT NOT NULL REFERENCES data_tables(id) ON DELETE CASCADE,
  data        JSONB NOT NULL DEFAULT '{}',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE data_table_changes (
  id        TEXT PRIMARY KEY,
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  table_id  TEXT NOT NULL REFERENCES data_tables(id) ON DELETE CASCADE,
  row_id    TEXT,
  action    TEXT NOT NULL CHECK (action IN ('insert','update','delete','schema_change')),
  actor     TEXT NOT NULL DEFAULT 'user' CHECK (actor IN ('user','ai','system')),
  run_id    TEXT REFERENCES runs(id) ON DELETE SET NULL,
  diff      JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE claude_usage_snapshots (
  id                    TEXT PRIMARY KEY,
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date                  TEXT NOT NULL,
  recorded_at           TIMESTAMPTZ NOT NULL,
  total_input_tokens    INTEGER NOT NULL DEFAULT 0,
  total_output_tokens   INTEGER NOT NULL DEFAULT 0,
  sonnet_input_tokens   INTEGER NOT NULL DEFAULT 0,
  sonnet_output_tokens  INTEGER NOT NULL DEFAULT 0,
  openhelm_input_tokens  INTEGER NOT NULL DEFAULT 0,
  openhelm_output_tokens INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, date)
);

CREATE TABLE targets (
  id            TEXT PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_id       TEXT REFERENCES goals(id) ON DELETE CASCADE,
  job_id        TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  data_table_id TEXT NOT NULL REFERENCES data_tables(id) ON DELETE CASCADE,
  column_id     TEXT NOT NULL,
  target_value  REAL NOT NULL,
  direction     TEXT NOT NULL DEFAULT 'gte' CHECK (direction IN ('gte','lte','eq')),
  aggregation   TEXT NOT NULL DEFAULT 'latest'
                  CHECK (aggregation IN ('latest','sum','avg','max','min','count')),
  label         TEXT,
  deadline      TIMESTAMPTZ,
  created_by    TEXT NOT NULL DEFAULT 'user' CHECK (created_by IN ('user','ai')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE visualizations (
  id            TEXT PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  goal_id       TEXT REFERENCES goals(id) ON DELETE SET NULL,
  job_id        TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  data_table_id TEXT NOT NULL REFERENCES data_tables(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  chart_type    TEXT NOT NULL DEFAULT 'line'
                  CHECK (chart_type IN ('line','bar','area','pie','stat')),
  config        JSONB NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','suggested','dismissed')),
  source        TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','system')),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inbox_events (
  id               TEXT PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id       TEXT REFERENCES projects(id) ON DELETE CASCADE,
  category         TEXT NOT NULL
                     CHECK (category IN ('alert','action','run','chat','memory',
                                         'data','credential','insight','system')),
  event_type       TEXT NOT NULL,
  importance       INTEGER NOT NULL DEFAULT 50,
  title            TEXT NOT NULL,
  body             TEXT,
  source_id        TEXT,
  source_type      TEXT
                     CHECK (source_type IN ('run','message','dashboard_item','memory',
                                            'data_table','credential','proposal','job')),
  metadata         JSONB NOT NULL DEFAULT '{}',
  conversation_id  TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  reply_to_event_id TEXT,
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','resolved','dismissed')),
  resolved_at      TIMESTAMPTZ,
  event_at         TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE run_logs (
  id        TEXT PRIMARY KEY,
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_id    TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  sequence  INTEGER NOT NULL,
  stream    TEXT NOT NULL CHECK (stream IN ('stdout','stderr')),
  text      TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cloud-only tables
CREATE TABLE usage_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_id          TEXT,
  call_type       TEXT NOT NULL
                    CHECK (call_type IN ('execution','planning','chat','assessment')),
  model           TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL,
  output_tokens   INTEGER NOT NULL,
  raw_cost_usd    NUMERIC(10,6) NOT NULL,
  billed_cost_usd NUMERIC(10,6) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id      TEXT NOT NULL,
  stripe_subscription_id  TEXT,
  plan                    TEXT NOT NULL CHECK (plan IN ('starter','growth','scale')),
  status                  TEXT NOT NULL
                            CHECK (status IN ('active','past_due','cancelled','trialing')),
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  included_token_credits  BIGINT NOT NULL,
  used_token_credits      BIGINT NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_projects_user         ON projects(user_id);
CREATE INDEX idx_goals_project         ON goals(project_id);
CREATE INDEX idx_goals_user            ON goals(user_id);
CREATE INDEX idx_jobs_project          ON jobs(project_id);
CREATE INDEX idx_jobs_user             ON jobs(user_id);
CREATE INDEX idx_jobs_next_fire        ON jobs(next_fire_at) WHERE is_enabled = true AND is_archived = false;
CREATE INDEX idx_runs_job              ON runs(job_id);
CREATE INDEX idx_runs_user             ON runs(user_id);
CREATE INDEX idx_runs_status           ON runs(status);
CREATE INDEX idx_run_logs_run_seq      ON run_logs(run_id, sequence);
CREATE INDEX idx_run_logs_user         ON run_logs(user_id);
CREATE INDEX idx_conversations_project ON conversations(project_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_memories_project      ON memories(project_id);
CREATE INDEX idx_memories_user         ON memories(user_id);
CREATE INDEX idx_inbox_events_user     ON inbox_events(user_id);
CREATE INDEX idx_inbox_events_project  ON inbox_events(project_id);
CREATE INDEX idx_inbox_events_event_at ON inbox_events(event_at DESC);
CREATE INDEX idx_data_tables_project   ON data_tables(project_id);
CREATE INDEX idx_data_table_rows_table ON data_table_rows(table_id, sort_order);
CREATE INDEX idx_usage_user_month      ON usage_records(user_id, created_at);
CREATE INDEX idx_usage_run             ON usage_records(run_id);
CREATE INDEX idx_inbox_items_user      ON inbox_items(user_id);
CREATE INDEX idx_inbox_items_project   ON inbox_items(project_id);
CREATE INDEX idx_autopilot_proposals_project ON autopilot_proposals(project_id);

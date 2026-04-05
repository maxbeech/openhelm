CREATE TABLE inbox_events (
  id                TEXT PRIMARY KEY,
  project_id        TEXT REFERENCES projects(id) ON DELETE CASCADE,
  category          TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  importance        INTEGER NOT NULL DEFAULT 50,
  title             TEXT NOT NULL,
  body              TEXT,
  source_id         TEXT,
  source_type       TEXT,
  metadata          TEXT NOT NULL DEFAULT '{}',
  conversation_id   TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  reply_to_event_id TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  resolved_at       TEXT,
  event_at          TEXT NOT NULL,
  created_at        TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_inbox_events_project_event_at ON inbox_events(project_id, event_at DESC);
--> statement-breakpoint
CREATE INDEX idx_inbox_events_importance ON inbox_events(project_id, importance DESC);
--> statement-breakpoint
CREATE INDEX idx_inbox_events_category ON inbox_events(project_id, category);
--> statement-breakpoint
CREATE INDEX idx_inbox_events_source ON inbox_events(source_type, source_id);
--> statement-breakpoint
CREATE INDEX idx_inbox_events_status ON inbox_events(project_id, status);

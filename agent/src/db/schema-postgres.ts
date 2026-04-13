/**
 * OpenHelm Cloud — Drizzle Postgres Schema
 *
 * Mirrors agent/src/db/schema.ts (SQLite) with Postgres-appropriate types:
 *   - TIMESTAMPTZ instead of TEXT for timestamps
 *   - BOOLEAN instead of INTEGER(boolean) for flags
 *   - JSONB instead of TEXT for JSON columns
 *   - user_id UUID (references auth.users) on every table for multi-tenant RLS
 *
 * Used by: Worker Service (Phase 4), cloud-mode database client.
 * The SQLite schema (schema.ts) remains the source of truth for local mode.
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  real,
  bigint,
  uuid,
  timestamp,
  jsonb,
  numeric,
  primaryKey,
  unique,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ── Helper: standard timestamp columns ────────────────────────────────────────

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// ── Settings ──────────────────────────────────────────────────────────────────

export const settings = pgTable(
  "settings",
  {
    userId:    uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    key:       text("key").notNull(),
    value:     text("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

// ── Projects ──────────────────────────────────────────────────────────────────

export const projects = pgTable("projects", {
  id:            text("id").primaryKey(),
  userId:        uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  name:          text("name").notNull(),
  description:   text("description"),
  directoryPath: text("directory_path").notNull(),
  gitUrl:        text("git_url"),
  ...timestamps,
});

// ── Goals ─────────────────────────────────────────────────────────────────────

export const goals = pgTable("goals", {
  id:          text("id").primaryKey(),
  userId:      uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  projectId:   text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  parentId:    text("parent_id").references((): AnyPgColumn => goals.id, { onDelete: "cascade" }),
  name:        text("name").notNull().default(""),
  description: text("description").notNull().default(""),
  status:      text("status", { enum: ["active", "paused", "archived"] }).notNull().default("active"),
  icon:        text("icon"),
  isSystem:    boolean("is_system").notNull().default(false),
  sortOrder:   integer("sort_order").notNull().default(0),
  ...timestamps,
});

// ── Jobs ──────────────────────────────────────────────────────────────────────

export const jobs = pgTable("jobs", {
  id:                     text("id").primaryKey(),
  userId:                 uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  goalId:                 text("goal_id").references(() => goals.id, { onDelete: "set null" }),
  projectId:              text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name:                   text("name").notNull(),
  description:            text("description"),
  prompt:                 text("prompt").notNull(),
  scheduleType:           text("schedule_type", { enum: ["once", "interval", "cron", "calendar", "manual"] }).notNull(),
  scheduleConfig:         jsonb("schedule_config").notNull().default({}),
  isEnabled:              boolean("is_enabled").notNull().default(true),
  isArchived:             boolean("is_archived").notNull().default(false),
  workingDirectory:       text("working_directory"),
  nextFireAt:             timestamp("next_fire_at", { withTimezone: true }),
  model:                  text("model").notNull().default("sonnet"),
  modelEffort:            text("model_effort").notNull().default("medium"),
  permissionMode:         text("permission_mode").notNull().default("bypassPermissions"),
  icon:                   text("icon"),
  correctionNote:         text("correction_note"),
  silenceTimeoutMinutes:  integer("silence_timeout_minutes"),
  source:                 text("source").notNull().default("user"),
  systemCategory:         text("system_category"),
  sortOrder:              integer("sort_order").notNull().default(0),
  ...timestamps,
});

// ── Runs ──────────────────────────────────────────────────────────────────────

export const runs = pgTable("runs", {
  id:             text("id").primaryKey(),
  userId:         uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  jobId:          text("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  status:         text("status", {
    enum: ["deferred", "queued", "running", "succeeded", "failed", "permanent_failure", "cancelled"],
  }).notNull().default("queued"),
  triggerSource:  text("trigger_source", { enum: ["scheduled", "manual", "corrective"] }).notNull(),
  parentRunId:    text("parent_run_id").references((): AnyPgColumn => runs.id, { onDelete: "set null" }),
  correctionNote: text("correction_note"),
  scheduledFor:   timestamp("scheduled_for", { withTimezone: true }),
  startedAt:      timestamp("started_at", { withTimezone: true }),
  finishedAt:     timestamp("finished_at", { withTimezone: true }),
  exitCode:       integer("exit_code"),
  summary:        text("summary"),
  sessionId:      text("session_id"),
  inputTokens:    integer("input_tokens"),
  outputTokens:   integer("output_tokens"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Conversations ─────────────────────────────────────────────────────────────

export const conversations = pgTable("conversations", {
  id:         text("id").primaryKey(),
  userId:     uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  projectId:  text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  channel:    text("channel").notNull().default("app"),
  title:      text("title"),
  sortOrder:  integer("sort_order").notNull().default(0),
  ...timestamps,
});

// ── Messages ──────────────────────────────────────────────────────────────────

export const messages = pgTable("messages", {
  id:             text("id").primaryKey(),
  userId:         uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role:           text("role", { enum: ["user", "assistant", "system", "tool_result"] }).notNull(),
  content:        text("content").notNull(),
  toolCalls:      jsonb("tool_calls"),
  toolResults:    jsonb("tool_results"),
  pendingActions: jsonb("pending_actions"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Inbox Items ───────────────────────────────────────────────────────────────

export const dashboardItems = pgTable("inbox_items", {
  id:         text("id").primaryKey(),
  userId:     uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  runId:      text("run_id").references(() => runs.id, { onDelete: "cascade" }),
  jobId:      text("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  projectId:  text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  type:       text("type", {
    enum: ["permanent_failure", "human_in_loop", "autopilot_limit", "captcha_intervention",
           "auth_required", "mcp_unavailable", "captain_insight"],
  }).notNull(),
  status:     text("status", { enum: ["open", "resolved", "dismissed"] }).notNull().default("open"),
  title:      text("title").notNull(),
  message:    text("message").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

// ── Memories ──────────────────────────────────────────────────────────────────

export const memories = pgTable("memories", {
  id:             text("id").primaryKey(),
  userId:         uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  projectId:      text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  goalId:         text("goal_id").references(() => goals.id, { onDelete: "set null" }),
  jobId:          text("job_id").references(() => jobs.id, { onDelete: "set null" }),
  type:           text("type", { enum: ["semantic", "episodic", "procedural", "source"] }).notNull(),
  content:        text("content").notNull(),
  sourceType:     text("source_type", { enum: ["run", "goal", "job", "chat", "user", "system"] }).notNull(),
  sourceId:       text("source_id"),
  importance:     integer("importance").notNull().default(5),
  accessCount:    integer("access_count").notNull().default(0),
  lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
  tags:           jsonb("tags").notNull().default([]),
  embedding:      jsonb("embedding"),
  isArchived:     boolean("is_archived").notNull().default(false),
  ...timestamps,
});

// ── Run Memories (junction) ───────────────────────────────────────────────────

export const runMemories = pgTable(
  "run_memories",
  {
    runId:    text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    memoryId: text("memory_id").notNull().references(() => memories.id, { onDelete: "cascade" }),
    userId:   uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.runId, t.memoryId] })],
);

// ── Autopilot Proposals ───────────────────────────────────────────────────────

export const autopilotProposals = pgTable("autopilot_proposals", {
  id:          text("id").primaryKey(),
  userId:      uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  goalId:      text("goal_id").notNull().references(() => goals.id, { onDelete: "cascade" }),
  projectId:   text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  status:      text("status", { enum: ["pending", "approved", "rejected", "expired"] }).notNull().default("pending"),
  plannedJobs: jsonb("planned_jobs").notNull().default([]),
  reason:      text("reason").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt:  timestamp("resolved_at", { withTimezone: true }),
});

// ── Credentials ───────────────────────────────────────────────────────────────

export const credentials = pgTable("credentials", {
  id:                     text("id").primaryKey(),
  userId:                 uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  name:                   text("name").notNull(),
  type:                   text("type", { enum: ["token", "username_password"] }).notNull(),
  envVarName:             text("env_var_name").notNull(),
  allowPromptInjection:   boolean("allow_prompt_injection").notNull().default(false),
  allowBrowserInjection:  boolean("allow_browser_injection").notNull().default(false),
  browserProfileName:     text("browser_profile_name"),
  browserProfileStorageKey:  text("browser_profile_storage_key"),
  browserProfileVerifiedAt:  timestamp("browser_profile_verified_at", { withTimezone: true }),
  scopeType:              text("scope_type", { enum: ["global", "project", "goal", "job"] }).notNull().default("global"),
  scopeId:                text("scope_id"),
  isEnabled:              boolean("is_enabled").notNull().default(true),
  lastUsedAt:             timestamp("last_used_at", { withTimezone: true }),
  ...timestamps,
});

// ── Credential Scope Bindings (junction) ──────────────────────────────────────

export const credentialScopeBindings = pgTable(
  "credential_scope_bindings",
  {
    credentialId: text("credential_id").notNull().references(() => credentials.id, { onDelete: "cascade" }),
    scopeType:    text("scope_type", { enum: ["project", "goal", "job"] }).notNull(),
    scopeId:      text("scope_id").notNull(),
    userId:       uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.credentialId, t.scopeType, t.scopeId] })],
);

// ── Run Credentials (junction) ────────────────────────────────────────────────

export const runCredentials = pgTable(
  "run_credentials",
  {
    runId:           text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    credentialId:    text("credential_id").notNull().references(() => credentials.id, { onDelete: "cascade" }),
    injectionMethod: text("injection_method", { enum: ["env", "prompt", "browser"] }).notNull(),
    userId:          uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.runId, t.credentialId, t.injectionMethod] })],
);

// ── Data Tables ───────────────────────────────────────────────────────────────

export const dataTables = pgTable("data_tables", {
  id:          text("id").primaryKey(),
  userId:      uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  projectId:   text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name:        text("name").notNull(),
  description: text("description"),
  columns:     jsonb("columns").notNull().default([]),
  embedding:   jsonb("embedding"),
  rowCount:    integer("row_count").notNull().default(0),
  isSystem:    boolean("is_system").notNull().default(false),
  createdBy:   text("created_by", { enum: ["user", "ai"] }).notNull().default("user"),
  ...timestamps,
});

// ── Data Table Rows ───────────────────────────────────────────────────────────

export const dataTableRows = pgTable("data_table_rows", {
  id:        text("id").primaryKey(),
  userId:    uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  tableId:   text("table_id").notNull().references(() => dataTables.id, { onDelete: "cascade" }),
  data:      jsonb("data").notNull().default({}),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

// ── Data Table Changes ────────────────────────────────────────────────────────

export const dataTableChanges = pgTable("data_table_changes", {
  id:        text("id").primaryKey(),
  userId:    uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  tableId:   text("table_id").notNull().references(() => dataTables.id, { onDelete: "cascade" }),
  rowId:     text("row_id"),
  action:    text("action", { enum: ["insert", "update", "delete", "schema_change"] }).notNull(),
  actor:     text("actor", { enum: ["user", "ai", "system"] }).notNull().default("user"),
  runId:     text("run_id").references(() => runs.id, { onDelete: "set null" }),
  diff:      jsonb("diff").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Claude Usage Snapshots ────────────────────────────────────────────────────

export const claudeUsageSnapshots = pgTable(
  "claude_usage_snapshots",
  {
    id:                   text("id").primaryKey(),
    userId:               uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    date:                 text("date").notNull(),
    recordedAt:           timestamp("recorded_at", { withTimezone: true }).notNull(),
    totalInputTokens:     integer("total_input_tokens").notNull().default(0),
    totalOutputTokens:    integer("total_output_tokens").notNull().default(0),
    sonnetInputTokens:    integer("sonnet_input_tokens").notNull().default(0),
    sonnetOutputTokens:   integer("sonnet_output_tokens").notNull().default(0),
    openHelmInputTokens:  integer("openhelm_input_tokens").notNull().default(0),
    openHelmOutputTokens: integer("openhelm_output_tokens").notNull().default(0),
  },
  (t) => [unique().on(t.userId, t.date)],
);

// ── Targets ───────────────────────────────────────────────────────────────────

export const targets = pgTable("targets", {
  id:           text("id").primaryKey(),
  userId:       uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  goalId:       text("goal_id").references(() => goals.id, { onDelete: "cascade" }),
  jobId:        text("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  projectId:    text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  dataTableId:  text("data_table_id").notNull().references(() => dataTables.id, { onDelete: "cascade" }),
  columnId:     text("column_id").notNull(),
  targetValue:  real("target_value").notNull(),
  direction:    text("direction", { enum: ["gte", "lte", "eq"] }).notNull().default("gte"),
  aggregation:  text("aggregation", { enum: ["latest", "sum", "avg", "max", "min", "count"] }).notNull().default("latest"),
  label:        text("label"),
  deadline:     timestamp("deadline", { withTimezone: true }),
  createdBy:    text("created_by", { enum: ["user", "ai"] }).notNull().default("user"),
  ...timestamps,
});

// ── Visualizations ────────────────────────────────────────────────────────────

export const visualizations = pgTable("visualizations", {
  id:           text("id").primaryKey(),
  userId:       uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  projectId:    text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  goalId:       text("goal_id").references(() => goals.id, { onDelete: "set null" }),
  jobId:        text("job_id").references(() => jobs.id, { onDelete: "set null" }),
  dataTableId:  text("data_table_id").notNull().references(() => dataTables.id, { onDelete: "cascade" }),
  name:         text("name").notNull(),
  description:  text("description"),
  chartType:    text("chart_type", { enum: ["line", "bar", "area", "pie", "stat"] }).notNull().default("line"),
  config:       jsonb("config").notNull().default({}),
  status:       text("status", { enum: ["active", "suggested", "dismissed"] }).notNull().default("active"),
  source:       text("source", { enum: ["user", "system"] }).notNull().default("user"),
  sortOrder:    integer("sort_order").notNull().default(0),
  ...timestamps,
});

// ── Inbox Events ──────────────────────────────────────────────────────────────

export const inboxEvents = pgTable("inbox_events", {
  id:              text("id").primaryKey(),
  userId:          uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  projectId:       text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  category:        text("category", {
    enum: ["alert", "action", "run", "chat", "memory", "data", "credential", "insight", "system"],
  }).notNull(),
  eventType:       text("event_type").notNull(),
  importance:      integer("importance").notNull().default(50),
  title:           text("title").notNull(),
  body:            text("body"),
  sourceId:        text("source_id"),
  sourceType:      text("source_type", {
    enum: ["run", "message", "dashboard_item", "memory", "data_table", "credential", "proposal", "job"],
  }),
  metadata:        jsonb("metadata").notNull().default({}),
  conversationId:  text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  replyToEventId:  text("reply_to_event_id"),
  status:          text("status", { enum: ["active", "resolved", "dismissed"] }).notNull().default("active"),
  resolvedAt:      timestamp("resolved_at", { withTimezone: true }),
  eventAt:         timestamp("event_at", { withTimezone: true }).notNull(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Run Logs ──────────────────────────────────────────────────────────────────

export const runLogs = pgTable("run_logs", {
  id:        text("id").primaryKey(),
  userId:    uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  runId:     text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  sequence:  integer("sequence").notNull(),
  stream:    text("stream", { enum: ["stdout", "stderr"] }).notNull(),
  text:      text("text").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

// ── Cloud-only: Usage Records ─────────────────────────────────────────────────

export const usageRecords = pgTable("usage_records", {
  id:           uuid("id").primaryKey().defaultRandom(),
  userId:       uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  runId:        text("run_id"),
  callType:     text("call_type", { enum: ["execution", "planning", "chat", "assessment"] }).notNull(),
  model:        text("model").notNull(),
  inputTokens:  integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  rawCostUsd:   numeric("raw_cost_usd", { precision: 10, scale: 6 }).notNull(),
  billedCostUsd: numeric("billed_cost_usd", { precision: 10, scale: 6 }).notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Cloud-only: Subscriptions ─────────────────────────────────────────────────

export const subscriptions = pgTable("subscriptions", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  userId:               uuid("user_id").notNull().unique().references(() => authUsers.id, { onDelete: "cascade" }),
  stripeCustomerId:     text("stripe_customer_id").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  plan:                 text("plan", { enum: ["starter", "growth", "scale"] }).notNull(),
  status:               text("status", { enum: ["active", "past_due", "cancelled", "trialing"] }).notNull(),
  currentPeriodStart:   timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd:     timestamp("current_period_end", { withTimezone: true }),
  includedTokenCredits: bigint("included_token_credits", { mode: "number" }).notNull(),
  usedTokenCredits:     bigint("used_token_credits", { mode: "number" }).notNull().default(0),
  ...timestamps,
});

// ── Auth users reference (Supabase built-in, not managed by Drizzle) ──────────
// This is a reference type only — do not run CREATE TABLE on this.
// Defined so Drizzle can type foreign key references correctly.

export const authUsers = pgTable("users", {
  id: uuid("id").primaryKey(),
});

// ── Realtime channel naming conventions ───────────────────────────────────────
// These are constants, not schema. Import where needed.

export const REALTIME_CHANNELS = {
  /** Live log streaming during an agent run */
  runStream: (runId: string) => `run:${runId}`,
  /** Inbox events, status changes, chat messages for a user */
  userEvents: (userId: string) => `user:${userId}:events`,
} as const;

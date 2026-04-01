import { sqliteTable, text, integer, real, primaryKey, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

/** Key-value settings store. Used for user preferences, API keys, etc. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** A local project directory that Claude Code works within */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  directoryPath: text("directory_path").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** A high-level outcome the user wants to achieve within a project */
export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  parentId: text("parent_id").references((): AnySQLiteColumn => goals.id, { onDelete: "cascade" }),
  name: text("name").notNull().default(""),
  description: text("description").notNull().default(""),
  status: text("status", { enum: ["active", "paused", "archived"] })
    .notNull()
    .default("active"),
  icon: text("icon"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** A scheduled Claude Code task — optionally tied to a goal */
export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  goalId: text("goal_id").references(() => goals.id, { onDelete: "set null" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  prompt: text("prompt").notNull(),
  scheduleType: text("schedule_type", {
    enum: ["once", "interval", "cron", "calendar", "manual"],
  }).notNull(),
  scheduleConfig: text("schedule_config").notNull(), // JSON string
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
  isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
  workingDirectory: text("working_directory"),
  nextFireAt: text("next_fire_at"),
  model: text("model").notNull().default("sonnet"),
  modelEffort: text("model_effort").notNull().default("medium"),
  permissionMode: text("permission_mode").notNull().default("bypassPermissions"),
  icon: text("icon"),
  correctionNote: text("correction_note"),
  silenceTimeoutMinutes: integer("silence_timeout_minutes"),
  source: text("source").notNull().default("user"),
  systemCategory: text("system_category"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** A single execution of a job */
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: [
      "deferred",
      "queued",
      "running",
      "succeeded",
      "failed",
      "permanent_failure",
      "cancelled",
    ],
  })
    .notNull()
    .default("queued"),
  triggerSource: text("trigger_source", {
    enum: ["scheduled", "manual", "corrective"],
  }).notNull(),
  parentRunId: text("parent_run_id").references((): AnySQLiteColumn => runs.id, { onDelete: "set null" }),
  correctionNote: text("correction_note"),
  scheduledFor: text("scheduled_for"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  exitCode: integer("exit_code"),
  summary: text("summary"),
  sessionId: text("session_id"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** A conversation thread for the AI chat sidebar (multiple per project supported) */
export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  /** NULL = "All Projects" thread; non-null = project-specific thread */
  projectId: text("project_id")
    .references(() => projects.id, { onDelete: "cascade" }),
  /** Channel source — 'app' for the desktop UI, extensible for WhatsApp/Slack/etc. */
  channel: text("channel").notNull().default("app"),
  title: text("title"),
  /** User-controlled ordering within a project's thread list */
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** A single chat message in a conversation */
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant", "system", "tool_result"] }).notNull(),
  content: text("content").notNull(),
  /** JSON array of ChatToolCall objects when the assistant invokes tools */
  toolCalls: text("tool_calls"),
  /** JSON array of ChatToolResult objects with execution results */
  toolResults: text("tool_results"),
  /** JSON array of PendingAction objects awaiting user confirmation */
  pendingActions: text("pending_actions"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** Actionable items surfaced to the user (permanent failures, HITL prompts) */
export const dashboardItems = sqliteTable("inbox_items", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .references(() => runs.id, { onDelete: "cascade" }),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["permanent_failure", "human_in_loop", "autopilot_limit", "captcha_intervention", "auth_required", "mcp_unavailable"] }).notNull(),
  status: text("status", { enum: ["open", "resolved", "dismissed"] })
    .notNull()
    .default("open"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  resolvedAt: text("resolved_at"),
});

/** Project memories — atomic knowledge extracted from runs, goals, jobs, or user input */
export const memories = sqliteTable("memories", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  goalId: text("goal_id").references(() => goals.id, { onDelete: "set null" }),
  jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),
  type: text("type", { enum: ["semantic", "episodic", "procedural", "source"] }).notNull(),
  content: text("content").notNull(),
  sourceType: text("source_type", {
    enum: ["run", "goal", "job", "chat", "user", "system"],
  }).notNull(),
  sourceId: text("source_id"),
  importance: integer("importance", { mode: "number" }).notNull().default(5),
  accessCount: integer("access_count").notNull().default(0),
  lastAccessedAt: text("last_accessed_at"),
  tags: text("tags").notNull().default("[]"), // JSON array of strings
  embedding: text("embedding"), // JSON array of 384 floats
  isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** Tracks which memories were injected into each run's prompt (transparency) */
export const runMemories = sqliteTable("run_memories", {
  runId: text("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  memoryId: text("memory_id")
    .notNull()
    .references(() => memories.id, { onDelete: "cascade" }),
});

/** Autopilot proposals: pending system job proposals awaiting user approval */
export const autopilotProposals = sqliteTable("autopilot_proposals", {
  id: text("id").primaryKey(),
  goalId: text("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["pending", "approved", "rejected", "expired"] })
    .notNull()
    .default("pending"),
  plannedJobs: text("planned_jobs").notNull(), // JSON: PlannedSystemJob[]
  reason: text("reason").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  resolvedAt: text("resolved_at"),
});

/** Credential metadata — secret values are stored in macOS Keychain, NOT here */
export const credentials = sqliteTable("credentials", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", { enum: ["token", "username_password"] }).notNull(),
  /** Auto-generated from name, e.g. OPENHELM_GITHUB_TOKEN */
  envVarName: text("env_var_name").notNull(),
  /** When true, value is also injected into prompt context (sent to Anthropic) */
  allowPromptInjection: integer("allow_prompt_injection", { mode: "boolean" }).notNull().default(false),
  /** When true, credential is injected directly into the browser MCP (no env var, no prompt) */
  allowBrowserInjection: integer("allow_browser_injection", { mode: "boolean" }).notNull().default(false),
  scopeType: text("scope_type", { enum: ["global", "project", "goal", "job"] }).notNull().default("global"),
  scopeId: text("scope_id"),
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** Many-to-many: a credential bound to one or more project/goal/job scopes */
export const credentialScopeBindings = sqliteTable(
  "credential_scope_bindings",
  {
    credentialId: text("credential_id")
      .notNull()
      .references(() => credentials.id, { onDelete: "cascade" }),
    scopeType: text("scope_type", { enum: ["project", "goal", "job"] }).notNull(),
    scopeId: text("scope_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.credentialId, t.scopeType, t.scopeId] })],
);

/** Audit trail: which credentials were injected into each run */
export const runCredentials = sqliteTable(
  "run_credentials",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    credentialId: text("credential_id")
      .notNull()
      .references(() => credentials.id, { onDelete: "cascade" }),
    injectionMethod: text("injection_method", { enum: ["env", "prompt", "browser"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.credentialId, t.injectionMethod] })],
);

/** User/AI-created structured data tables (Notion-style databases) */
export const dataTables = sqliteTable("data_tables", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  /** JSON: DataTableColumn[] — schema definition with stable column IDs */
  columns: text("columns").notNull().default("[]"),
  /** JSON: 384-dim float array for semantic relevance matching */
  embedding: text("embedding"),
  /** Denormalized row count, updated on insert/delete */
  rowCount: integer("row_count").notNull().default(0),
  createdBy: text("created_by", { enum: ["user", "ai"] }).notNull().default("user"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** Rows within a data table — data stored as JSON keyed by column ID */
export const dataTableRows = sqliteTable("data_table_rows", {
  id: text("id").primaryKey(),
  tableId: text("table_id")
    .notNull()
    .references(() => dataTables.id, { onDelete: "cascade" }),
  /** JSON object: { "col_xxx": value, "col_yyy": value, ... } */
  data: text("data").notNull().default("{}"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** Audit log of all data table mutations (for AI transparency + future undo) */
export const dataTableChanges = sqliteTable("data_table_changes", {
  id: text("id").primaryKey(),
  tableId: text("table_id")
    .notNull()
    .references(() => dataTables.id, { onDelete: "cascade" }),
  rowId: text("row_id"),
  action: text("action", { enum: ["insert", "update", "delete", "schema_change"] }).notNull(),
  actor: text("actor", { enum: ["user", "ai", "system"] }).notNull().default("user"),
  runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),
  /** JSON: diff details (old/new values for updates, full row for inserts) */
  diff: text("diff").notNull().default("{}"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/**
 * Daily snapshots of Claude Code token usage.
 * One row per UTC date; UPSERTED on each scanner refresh.
 * Tracks total usage (from ~/.claude/projects JSONL) and OpenHelm's share.
 */
export const claudeUsageSnapshots = sqliteTable("claude_usage_snapshots", {
  id: text("id").primaryKey(),
  date: text("date").notNull().unique(),
  recordedAt: text("recorded_at").notNull(),
  totalInputTokens: integer("total_input_tokens").notNull().default(0),
  totalOutputTokens: integer("total_output_tokens").notNull().default(0),
  sonnetInputTokens: integer("sonnet_input_tokens").notNull().default(0),
  sonnetOutputTokens: integer("sonnet_output_tokens").notNull().default(0),
  openHelmInputTokens: integer("openhelm_input_tokens").notNull().default(0),
  openHelmOutputTokens: integer("openhelm_output_tokens").notNull().default(0),
});

/** Numerical targets linked to data table columns for goal/job progress tracking */
export const targets = sqliteTable("targets", {
  id: text("id").primaryKey(),
  goalId: text("goal_id").references(() => goals.id, { onDelete: "cascade" }),
  jobId: text("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  dataTableId: text("data_table_id")
    .notNull()
    .references(() => dataTables.id, { onDelete: "cascade" }),
  columnId: text("column_id").notNull(),
  targetValue: real("target_value").notNull(),
  direction: text("direction", { enum: ["gte", "lte", "eq"] }).notNull().default("gte"),
  aggregation: text("aggregation", {
    enum: ["latest", "sum", "avg", "max", "min", "count"],
  }).notNull().default("latest"),
  label: text("label"),
  deadline: text("deadline"),
  createdBy: text("created_by", { enum: ["user", "ai"] }).notNull().default("user"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** Data table visualizations — charts linked to data table columns */
export const visualizations = sqliteTable("visualizations", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  goalId: text("goal_id").references(() => goals.id, { onDelete: "set null" }),
  jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),
  dataTableId: text("data_table_id")
    .notNull()
    .references(() => dataTables.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  chartType: text("chart_type", { enum: ["line", "bar", "area", "pie", "stat"] })
    .notNull()
    .default("line"),
  /** JSON: VisualizationConfig */
  config: text("config").notNull().default("{}"),
  status: text("status", { enum: ["active", "suggested", "dismissed"] })
    .notNull()
    .default("active"),
  source: text("source", { enum: ["user", "system"] })
    .notNull()
    .default("user"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** Real-time log chunks captured from Claude Code output */
export const runLogs = sqliteTable("run_logs", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  stream: text("stream", { enum: ["stdout", "stderr"] }).notNull(),
  text: text("text").notNull(),
  timestamp: text("timestamp")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

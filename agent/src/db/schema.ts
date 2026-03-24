import { sqliteTable, text, integer, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

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
  name: text("name").notNull().default(""),
  description: text("description").notNull().default(""),
  status: text("status", { enum: ["active", "paused", "archived"] })
    .notNull()
    .default("active"),
  icon: text("icon"),
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

/** A conversation thread for the AI chat sidebar (one per project for v1) */
export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  /** Channel source — 'app' for the desktop UI, extensible for WhatsApp/Slack/etc. */
  channel: text("channel").notNull().default("app"),
  title: text("title"),
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
export const inboxItems = sqliteTable("inbox_items", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["permanent_failure", "human_in_loop"] }).notNull(),
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

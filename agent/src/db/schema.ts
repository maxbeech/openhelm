import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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
  description: text("description").notNull(),
  status: text("status", { enum: ["active", "paused", "archived"] })
    .notNull()
    .default("active"),
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
    enum: ["once", "interval", "cron"],
  }).notNull(),
  scheduleConfig: text("schedule_config").notNull(), // JSON string
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
  nextFireAt: text("next_fire_at"),
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
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  exitCode: integer("exit_code"),
  summary: text("summary"),
  createdAt: text("created_at")
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

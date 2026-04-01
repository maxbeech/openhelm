/**
 * Tool definitions for the AI chat sidebar.
 * Read tools auto-execute; write tools require user confirmation.
 */

import { DATA_TABLE_TOOLS, describeDataTableAction } from "./data-table-tools.js";
import { TARGET_CHAT_TOOLS, describeTargetAction } from "./target-chat-tools.js";
import { VISUALIZATION_CHAT_TOOLS, describeVisualizationAction } from "./visualization-chat-tools.js";

export interface ParameterDef {
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** If true, modifies data and requires user approval before execution. */
  isWrite: boolean;
  parameters: Record<string, ParameterDef>;
}

export const TOOLS: ToolDefinition[] = [
  // ─── Read tools ───
  {
    name: "list_goals",
    description: "List goals for the active project. Use the 'name' filter to search by name when you know the goal name but not the ID.",
    isWrite: false,
    parameters: {
      status: { type: "string", description: "Filter by status", enum: ["active", "paused", "archived"] },
      name: { type: "string", description: "Filter by name (case-insensitive partial match)" },
    },
  },
  {
    name: "list_jobs",
    description: "List jobs, optionally filtered by goal ID.",
    isWrite: false,
    parameters: {
      goalId: { type: "string", description: "Filter to a specific goal" },
    },
  },
  {
    name: "list_runs",
    description: "List recent runs, optionally filtered by job.",
    isWrite: false,
    parameters: {
      jobId: { type: "string", description: "Filter to a specific job" },
      limit: { type: "number", description: "Max runs to return (default 10)" },
    },
  },
  {
    name: "get_run_logs",
    description: "Get the full log output for a specific run.",
    isWrite: false,
    parameters: {
      runId: { type: "string", description: "Run ID", required: true },
    },
  },
  {
    name: "get_goal",
    description: "Get details for a specific goal.",
    isWrite: false,
    parameters: {
      goalId: { type: "string", description: "Goal ID", required: true },
    },
  },
  {
    name: "get_job",
    description: "Get details for a specific job.",
    isWrite: false,
    parameters: {
      jobId: { type: "string", description: "Job ID", required: true },
    },
  },
  // ─── Write tools (require confirmation) ───
  {
    name: "create_goal",
    description: "Create a new goal for the active project. Can be a sub-goal of an existing goal.",
    isWrite: true,
    parameters: {
      name: { type: "string", description: "Short goal name", required: true },
      description: { type: "string", description: "Detailed description" },
      parentGoalId: { type: "string", description: "ID of the parent goal (for creating sub-goals)" },
    },
  },
  {
    name: "create_job",
    description: "Create a new scheduled job.",
    isWrite: true,
    parameters: {
      name: { type: "string", description: "Job name", required: true },
      prompt: { type: "string", description: "The Claude Code prompt", required: true },
      goalId: { type: "string", description: "Goal ID to attach to (optional)" },
      scheduleType: { type: "string", description: "'once', 'interval', 'calendar', or 'cron'. Prefer 'calendar' over 'cron' for simple schedules (daily/weekly/monthly).", required: true, enum: ["once", "interval", "calendar", "cron"] },
      intervalMinutes: { type: "number", description: "For interval: minutes between runs" },
      cronExpression: { type: "string", description: "For cron: cron expression (only use for complex schedules not expressible via calendar)" },
      calendarFrequency: { type: "string", description: "For calendar: 'daily', 'weekly', or 'monthly'", enum: ["daily", "weekly", "monthly"] },
      calendarTime: { type: "string", description: "For calendar: time in HH:MM format (e.g. '09:00')" },
      calendarDayOfWeek: { type: "number", description: "For calendar weekly: day of week 0=Sun, 1=Mon, ..., 6=Sat" },
      calendarDayOfMonth: { type: "number", description: "For calendar monthly: day of month 1-31" },
      workingDirectory: { type: "string", description: "Working directory (defaults to project dir)" },
    },
  },
  {
    name: "update_goal",
    description: "Update a goal's name, description, or status.",
    isWrite: true,
    parameters: {
      goalId: { type: "string", description: "Goal ID", required: true },
      name: { type: "string", description: "New name" },
      description: { type: "string", description: "New description" },
      status: { type: "string", description: "New status", enum: ["active", "paused", "archived"] },
    },
  },
  {
    name: "update_job",
    description: "Update a job's name, prompt, schedule, or enabled state.",
    isWrite: true,
    parameters: {
      jobId: { type: "string", description: "Job ID", required: true },
      name: { type: "string", description: "New name" },
      prompt: { type: "string", description: "New prompt" },
      isEnabled: { type: "boolean", description: "Enable or disable the job" },
    },
  },
  {
    name: "archive_goal",
    description: "Archive a goal and all its jobs.",
    isWrite: true,
    parameters: {
      goalId: { type: "string", description: "Goal ID", required: true },
    },
  },
  {
    name: "archive_job",
    description: "Archive a job.",
    isWrite: true,
    parameters: {
      jobId: { type: "string", description: "Job ID", required: true },
    },
  },
  {
    name: "trigger_run",
    description: "Manually trigger a job run immediately, or schedule a one-off run for a future time.",
    isWrite: true,
    parameters: {
      jobId: { type: "string", description: "Job ID", required: true },
      fire_at: { type: "string", description: "ISO 8601 datetime to fire at (optional; fires immediately if omitted)" },
    },
  },
  // ─── Data table tools (imported) ───
  ...DATA_TABLE_TOOLS,
  // ─── Target tools (imported) ───
  ...TARGET_CHAT_TOOLS,
  // ─── Visualization tools (imported) ───
  ...VISUALIZATION_CHAT_TOOLS,
  // ─── Memory tools ───
  {
    name: "list_memories",
    description: "List project memories, optionally filtered by type or tag.",
    isWrite: false,
    parameters: {
      type: { type: "string", description: "Filter by type", enum: ["semantic", "episodic", "procedural", "source"] },
      tag: { type: "string", description: "Filter by tag" },
    },
  },
  {
    name: "save_memory",
    description: "Save a new memory for this project (e.g. user-shared info worth remembering).",
    isWrite: true,
    parameters: {
      content: { type: "string", description: "The memory content (1-2 sentences)", required: true },
      type: { type: "string", description: "Memory type", required: true, enum: ["semantic", "episodic", "procedural", "source"] },
      importance: { type: "number", description: "Importance 1-10 (default 5)" },
      tags: { type: "string", description: "Comma-separated tags" },
    },
  },
  {
    name: "update_memory",
    description: "Update an existing memory's content.",
    isWrite: true,
    parameters: {
      memoryId: { type: "string", description: "Memory ID", required: true },
      content: { type: "string", description: "New content" },
      importance: { type: "number", description: "New importance 1-10" },
    },
  },
  {
    name: "forget_memory",
    description: "Delete a memory that is no longer relevant.",
    isWrite: true,
    parameters: {
      memoryId: { type: "string", description: "Memory ID", required: true },
    },
  },
];

function getToolDef(name: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name);
}

export function isWriteTool(name: string): boolean {
  return getToolDef(name)?.isWrite ?? false;
}

/** Human-readable one-line summary of a write tool call (for the confirmation card). */
export function describeAction(tool: string, args: Record<string, unknown>): string {
  // Check specialized tools first
  const dtDesc = describeDataTableAction(tool, args);
  if (dtDesc) return dtDesc;
  const tgtDesc = describeTargetAction(tool, args);
  if (tgtDesc) return tgtDesc;
  const vizDesc = describeVisualizationAction(tool, args);
  if (vizDesc) return vizDesc;

  switch (tool) {
    case "create_goal": return `Create goal: "${args.name}"`;
    case "create_job": return `Create job: "${args.name}" (${args.scheduleType})`;
    case "update_goal": return `Update goal ${args.goalId}`;
    case "update_job": return `Update job ${args.jobId}`;
    case "archive_goal": return `Archive goal ${args.goalId}`;
    case "archive_job": return `Archive job ${args.jobId}`;
    case "trigger_run":
      return args.fire_at
        ? `Trigger run for job ${args.jobId} at ${args.fire_at}`
        : `Trigger run for job ${args.jobId}`;
    case "save_memory": return `Save memory: "${(args.content as string)?.slice(0, 50)}..."`;
    case "update_memory": return `Update memory ${args.memoryId}`;
    case "forget_memory": return `Delete memory ${args.memoryId}`;
    default: return tool;
  }
}

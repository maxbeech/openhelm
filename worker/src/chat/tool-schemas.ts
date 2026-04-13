/**
 * OpenAI-format tool schemas for cloud-mode chat.
 *
 * Two sets exist:
 *  - READ_ONLY_TOOLS — web search + data read tools, always safe to auto-execute
 *  - FULL_ACCESS_TOOLS — superset with create/update/archive write tools
 *
 * Descriptions and parameter shapes mirror agent/src/chat/tools.ts so the same
 * prompts behave the same across local and cloud modes.
 */

import type OpenAI from "openai";

type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

const WEB_SEARCH: Tool = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the public web and return the top results. Use this whenever the user asks a factual question or references information that may be on the web.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        maxResults: { type: "number", description: "Max results to return (default 5, max 10)" },
      },
      required: ["query"],
    },
  },
};

const WEB_FETCH: Tool = {
  type: "function",
  function: {
    name: "web_fetch",
    description:
      "Fetch a URL and return its readable text content (HTML tags stripped). Use this to read the actual contents of a web page — either one the user references directly or one you found via web_search.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL" },
        maxChars: { type: "number", description: "Max characters of text to return (default 8000)" },
      },
      required: ["url"],
    },
  },
};

const LIST_PROJECTS: Tool = {
  type: "function",
  function: {
    name: "list_projects",
    description: "List the user's projects.",
    parameters: { type: "object", properties: {} },
  },
};

const LIST_GOALS: Tool = {
  type: "function",
  function: {
    name: "list_goals",
    description: "List the user's goals. Optionally filter by project.",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Optional project ID to filter by" },
      },
    },
  },
};

const LIST_JOBS: Tool = {
  type: "function",
  function: {
    name: "list_jobs",
    description: "List the user's jobs. Optionally filter by project.",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Optional project ID to filter by" },
      },
    },
  },
};

const LIST_RUNS: Tool = {
  type: "function",
  function: {
    name: "list_runs",
    description: "List recent runs for a job, ordered newest first.",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "Job ID to list runs for" },
        limit: { type: "number", description: "Max runs to return (default 10)" },
      },
      required: ["jobId"],
    },
  },
};

const GET_RUN_LOGS: Tool = {
  type: "function",
  function: {
    name: "get_run_logs",
    description: "Fetch stdout/stderr log lines for a run.",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run ID" },
        limit: { type: "number", description: "Max log lines to return (default 100)" },
      },
      required: ["runId"],
    },
  },
};

const CREATE_GOAL: Tool = {
  type: "function",
  function: {
    name: "create_goal",
    description: "Create a new goal in a project.",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
      },
      required: ["projectId", "name"],
    },
  },
};

const ARCHIVE_GOAL: Tool = {
  type: "function",
  function: {
    name: "archive_goal",
    description: "Archive a goal (soft delete).",
    parameters: {
      type: "object",
      properties: { goalId: { type: "string" } },
      required: ["goalId"],
    },
  },
};

const CREATE_JOB: Tool = {
  type: "function",
  function: {
    name: "create_job",
    description: "Create a new job. schedule_type is one of 'once', 'interval', or 'cron'.",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        name: { type: "string" },
        prompt: { type: "string" },
        scheduleType: { type: "string", enum: ["once", "interval", "cron"] },
        scheduleConfig: { type: "object", description: "Shape depends on scheduleType" },
        goalId: { type: "string", description: "Optional parent goal ID" },
      },
      required: ["projectId", "name", "prompt", "scheduleType", "scheduleConfig"],
    },
  },
};

const ARCHIVE_JOB: Tool = {
  type: "function",
  function: {
    name: "archive_job",
    description: "Archive a job (soft delete).",
    parameters: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
};

export const READ_ONLY_TOOLS: Tool[] = [
  WEB_SEARCH,
  WEB_FETCH,
  LIST_PROJECTS,
  LIST_GOALS,
  LIST_JOBS,
  LIST_RUNS,
  GET_RUN_LOGS,
];

export const FULL_ACCESS_TOOLS: Tool[] = [
  ...READ_ONLY_TOOLS,
  CREATE_GOAL,
  ARCHIVE_GOAL,
  CREATE_JOB,
  ARCHIVE_JOB,
];

export function getToolsForMode(permissionMode: string): Tool[] {
  return permissionMode === "bypassPermissions" ? FULL_ACCESS_TOOLS : READ_ONLY_TOOLS;
}

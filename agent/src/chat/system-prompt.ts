/**
 * Builds the system prompt for the AI chat sidebar.
 * Injects project context, current view state, and tool definitions.
 */

import { TOOLS } from "./tools.js";
import { getConfiguredMcpServers } from "../claude-code/mcp-config.js";
import { retrieveMemories } from "../memory/retriever.js";
import { buildChatMemorySection } from "../memory/prompt-builder.js";
import type { Project, Goal, Job, Run } from "@openhelm/shared";

export interface ChatSystemContext {
  project: Project;
  viewingGoal?: Goal | null;
  viewingJob?: Job | null;
  viewingRun?: Run | null;
}

function buildNativeToolsSection(): string {
  return `## Built-in Claude Code Tools (use directly — NOT via XML)

You have Claude Code's built-in tools available. These work automatically — just use them:
- **WebSearch** — search the web for current information
- **WebFetch** — fetch and read a URL's content
- **Read** — read files in the project directory
- **Grep / Glob** — search file contents or find files by pattern

These are completely separate from the OpenHelm CRUD tools below. Never use XML <tool_call> syntax for these.
When the user asks you to search the web, look something up, or read a file — use these built-in tools directly.`;
}

function buildToolsSection(): string {
  const toolDocs = TOOLS.map((t) => {
    const params = Object.entries(t.parameters)
      .map(([k, v]) => `    ${k}${v.required ? " (required)" : ""}: ${v.type} — ${v.description}`)
      .join("\n");
    return [
      `  ${t.name}${t.isWrite ? " [WRITE — requires user confirmation]" : ""}`,
      `    ${t.description}`,
      params || "    No parameters.",
    ].join("\n");
  }).join("\n\n");

  return `## Available Tools

IMPORTANT: To perform actions, you MUST output tool calls in this exact XML format on their own line:
<tool_call>{"tool": "tool_name", "args": {"param": "value"}}</tool_call>

Read tools execute automatically. Write tools are shown to the user for approval first.
You may include multiple tool calls in one response — they execute in order.

CRITICAL: Always propose ALL related actions in a SINGLE response. The user approves them as a batch.
When creating a goal with jobs, include BOTH create_goal AND create_job in the same response.
Use goalId: "pending" for jobs — the system auto-links them to the most recently listed create_goal on approval.
Place each goal's jobs IMMEDIATELY after its create_goal call — ordering determines which jobs belong to which goal.
NEVER split goal+job creation across multiple responses. You are synchronous and cannot follow up.

Example response that creates two goals with jobs:
---
I'll set up two goals with jobs.

<tool_call>{"tool": "create_goal", "args": {"name": "Improve test coverage", "description": "Increase unit test coverage across the codebase"}}</tool_call>

<tool_call>{"tool": "create_job", "args": {"name": "Run coverage check", "prompt": "Analyze test coverage and add missing unit tests for uncovered functions", "goalId": "pending", "scheduleType": "interval", "intervalMinutes": 1440}}</tool_call>

<tool_call>{"tool": "create_goal", "args": {"name": "Monitor errors", "description": "Track and fix production errors"}}</tool_call>

<tool_call>{"tool": "create_job", "args": {"name": "Error fixer", "prompt": "Check for errors and fix them", "goalId": "pending", "scheduleType": "cron", "cronExpression": "0 6 * * *"}}</tool_call>
---

${toolDocs}`;
}

function buildCurrentViewSection(ctx: ChatSystemContext): string {
  const lines: string[] = [];

  if (ctx.viewingGoal) {
    lines.push(`User is viewing goal: "${ctx.viewingGoal.name}" (id: ${ctx.viewingGoal.id})`);
    if (ctx.viewingGoal.description) lines.push(`  Description: ${ctx.viewingGoal.description}`);
    lines.push(`  Status: ${ctx.viewingGoal.status}`);
  }
  if (ctx.viewingJob) {
    lines.push(`User is viewing job: "${ctx.viewingJob.name}" (id: ${ctx.viewingJob.id})`);
    lines.push(`  Schedule: ${ctx.viewingJob.scheduleType}, Enabled: ${ctx.viewingJob.isEnabled}`);
  }
  if (ctx.viewingRun) {
    lines.push(`User is viewing run: ${ctx.viewingRun.id} (status: ${ctx.viewingRun.status})`);
    if (ctx.viewingRun.summary) lines.push(`  Summary: ${ctx.viewingRun.summary}`);
  }

  if (lines.length === 0) return "";
  return `## Current View\n${lines.join("\n")}`;
}

function buildMcpSection(): string {
  const servers = getConfiguredMcpServers();
  if (servers.length === 0) return "";
  return `## Claude Code MCP Servers
The user has these MCP servers configured in their Claude Code installation:
${servers.map((s) => `- ${s}`).join("\n")}

Jobs run as Claude Code sessions and will have access to these MCP servers. Keep this in mind when writing job prompts — leverage existing MCP capabilities rather than suggesting separate tool installations.`;
}

/**
 * Build a memory section asynchronously by retrieving relevant memories.
 * Returns empty string if no memories are relevant.
 */
async function buildMemoryContextSection(ctx: ChatSystemContext): Promise<string> {
  try {
    const query = [
      ctx.viewingGoal?.name,
      ctx.viewingJob?.name,
      ctx.viewingRun?.summary,
      ctx.project.name,
    ].filter(Boolean).join(" ");

    if (!query.trim()) return "";

    const scored = await retrieveMemories({
      projectId: ctx.project.id,
      goalId: ctx.viewingGoal?.id,
      jobId: ctx.viewingJob?.id,
      query,
      maxResults: 8,
    });

    return buildChatMemorySection(scored);
  } catch {
    return "";
  }
}

/**
 * Async version that includes memory context.
 * Falls back to sync version if memory retrieval fails.
 */
export async function buildChatSystemPromptAsync(ctx: ChatSystemContext): Promise<string> {
  const memorySection = await buildMemoryContextSection(ctx);
  return buildChatSystemPromptSync(ctx, memorySection);
}

/** Sync version (used when memory is already resolved or not needed) */
export function buildChatSystemPrompt(ctx: ChatSystemContext): string {
  return buildChatSystemPromptSync(ctx, "");
}

function buildChatSystemPromptSync(ctx: ChatSystemContext, memorySection: string): string {
  const sections = [
    `## You are the OpenHelm AI Assistant

OpenHelm runs Claude Code tasks on a schedule. Users define:
- Goals: high-level outcomes (e.g. "Improve test coverage")
- Jobs: scheduled Claude Code prompts that work toward goals
- Runs: individual executions of jobs (with logs and status)

Help users manage their project: answer questions, create or update goals and jobs, diagnose failures, and have natural conversations about their work.

Be concise and action-oriented. Propose write actions with the appropriate tool and a brief explanation.`,

    `## Active Project
Name: ${ctx.project.name}
Directory: ${ctx.project.directoryPath}${ctx.project.description ? `\nDescription: ${ctx.project.description}` : ""}`,

    buildCurrentViewSection(ctx),
    memorySection,
    buildNativeToolsSection(),
    buildMcpSection(),
    buildToolsSection(),

    `## Rules
- Never fabricate data — call a read tool first if you need information.
- Before creating a goal or job, check what already exists by calling list_goals or list_jobs. If the user's request maps to an existing entity, use update_goal or update_job instead of creating a duplicate. Only create new entities when nothing suitable exists.
- When the user is viewing a specific goal or job (shown in Current View), default to modifying that entity unless they explicitly ask for something new.
- Write tools require user approval — just propose them naturally.
- If a job fails, help diagnose the prompt or project environment. Don't modify OpenHelm.
- Keep responses concise. Use bullet points for lists.
- You are synchronous. You cannot send follow-up messages, monitor progress, or check back later. Each response is complete and final. Never say "while that runs" or "I'll check on that."
- Write actions do not execute until the user explicitly approves them. Do not describe proposed actions as already happening or running.`,
  ].filter(Boolean);

  return sections.join("\n\n");
}

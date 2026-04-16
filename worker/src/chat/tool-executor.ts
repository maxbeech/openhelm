/**
 * Dispatches tool calls from the chat tool-loop to their implementations.
 *
 * Data tools use Supabase with explicit user_id filtering (defence in depth
 * on top of RLS). Web tools delegate to ./web-tools.js. Every case returns
 * a plain JSON-serialisable object; internal errors are caught and returned
 * as { error: string } so the LLM can recover rather than aborting the loop.
 */

import { getSupabase } from "../supabase.js";
import { fetchUrlAsText, searchWeb } from "./web-tools.js";

type Args = Record<string, unknown>;

export async function executeToolCall(
  name: string,
  args: Args,
  userId: string,
): Promise<unknown> {
  try {
    switch (name) {
      case "web_search":
        return await doWebSearch(args);
      case "web_fetch":
        return await doWebFetch(args);
      case "list_projects":
        return await listProjects(userId);
      case "list_goals":
        return await listGoals(args, userId);
      case "list_jobs":
        return await listJobs(args, userId);
      case "list_runs":
        return await listRuns(args, userId);
      case "get_run_logs":
        return await getRunLogs(args, userId);
      case "create_goal":
        return await createGoal(args, userId);
      case "archive_goal":
        return await archiveGoal(args, userId);
      case "create_job":
        return await createJob(args, userId);
      case "archive_job":
        return await archiveJob(args, userId);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Web tools ─────────────────────────────────────────────────────────────

async function doWebSearch(args: Args): Promise<unknown> {
  const query = String(args.query ?? "");
  if (!query) return { error: "query is required" };
  const maxResults = typeof args.maxResults === "number" ? args.maxResults : undefined;
  const results = await searchWeb(query, maxResults);
  return { results };
}

async function doWebFetch(args: Args): Promise<unknown> {
  const url = String(args.url ?? "");
  if (!url) return { error: "url is required" };
  const maxChars = typeof args.maxChars === "number" ? args.maxChars : undefined;
  return await fetchUrlAsText(url, maxChars);
}

// ─── Data tools (Supabase) ─────────────────────────────────────────────────

async function listProjects(userId: string): Promise<unknown> {
  const { data, error } = await getSupabase()
    .from("projects")
    .select("id, name, description, directory_path, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) return { error: error.message };
  return { projects: data ?? [] };
}

async function listGoals(args: Args, userId: string): Promise<unknown> {
  const q = getSupabase()
    .from("goals")
    .select("id, project_id, name, description, status, created_at")
    .eq("user_id", userId);
  const { data, error } = args.projectId
    ? await q.eq("project_id", String(args.projectId))
    : await q;
  if (error) return { error: error.message };
  return { goals: data ?? [] };
}

async function listJobs(args: Args, userId: string): Promise<unknown> {
  const q = getSupabase()
    .from("jobs")
    .select("id, project_id, goal_id, name, prompt, schedule_type, schedule_config, is_enabled, is_archived, next_fire_at, created_at")
    .eq("user_id", userId)
    .eq("is_archived", false);
  const { data, error } = args.projectId
    ? await q.eq("project_id", String(args.projectId))
    : await q;
  if (error) return { error: error.message };
  return { jobs: data ?? [] };
}

async function listRuns(args: Args, userId: string): Promise<unknown> {
  const jobId = String(args.jobId ?? "");
  if (!jobId) return { error: "jobId is required" };
  const limit = typeof args.limit === "number" ? args.limit : 10;
  const { data, error } = await getSupabase()
    .from("runs")
    .select("id, job_id, status, trigger_source, started_at, finished_at, exit_code, summary, created_at")
    .eq("user_id", userId)
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { error: error.message };
  return { runs: data ?? [] };
}

async function getRunLogs(args: Args, userId: string): Promise<unknown> {
  const runId = String(args.runId ?? "");
  if (!runId) return { error: "runId is required" };
  const limit = typeof args.limit === "number" ? args.limit : 100;
  const { data, error } = await getSupabase()
    .from("run_logs")
    .select("stream, text, timestamp")
    .eq("user_id", userId)
    .eq("run_id", runId)
    .order("sequence", { ascending: true })
    .limit(limit);
  if (error) return { error: error.message };
  return { logs: data ?? [] };
}

async function createGoal(args: Args, userId: string): Promise<unknown> {
  const projectId = String(args.projectId ?? "");
  const name = String(args.name ?? "");
  if (!projectId || !name) return { error: "projectId and name are required" };
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const { data, error } = await getSupabase()
    .from("goals")
    .insert({
      id,
      user_id: userId,
      project_id: projectId,
      name,
      description: args.description ? String(args.description) : null,
      status: "active",
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();
  if (error) return { error: error.message };
  return { goal: data };
}

async function archiveGoal(args: Args, userId: string): Promise<unknown> {
  const goalId = String(args.goalId ?? "");
  if (!goalId) return { error: "goalId is required" };
  const { data, error } = await getSupabase()
    .from("goals")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", goalId)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) return { error: error.message };
  return { goal: data };
}

async function createJob(args: Args, userId: string): Promise<unknown> {
  const projectId = String(args.projectId ?? "");
  const name = String(args.name ?? "");
  const prompt = String(args.prompt ?? "");
  const scheduleType = String(args.scheduleType ?? "");
  if (!projectId || !name || !prompt || !scheduleType) {
    return { error: "projectId, name, prompt, scheduleType are required" };
  }

  // Voice mode frequently stringifies scheduleConfig because the tool schema
  // declares it as a loose object without `properties`. Normalise here so
  // downstream code (format.ts describeCron, schedule.ts nextFireAt) can
  // always rely on a real object with typed fields.
  const scheduleConfig = normaliseScheduleConfig(scheduleType, args.scheduleConfig);
  if ("error" in scheduleConfig) return scheduleConfig;

  // Compute the first fire time for "once" jobs so the scheduler picks them
  // up immediately instead of waiting for an update to set next_fire_at.
  const now = new Date().toISOString();
  const nextFireAt = scheduleType === "once" ? now : null;

  const id = crypto.randomUUID();
  const { data, error } = await getSupabase()
    .from("jobs")
    .insert({
      id,
      user_id: userId,
      project_id: projectId,
      goal_id: args.goalId ? String(args.goalId) : null,
      name,
      prompt,
      schedule_type: scheduleType,
      schedule_config: scheduleConfig.value,
      is_enabled: true,
      is_archived: false,
      next_fire_at: nextFireAt,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();
  if (error) return { error: error.message };
  return { job: data };
}

/** Coerce LLM-provided scheduleConfig into the canonical shape expected by
 *  the database + schedule engine. Accepts objects, JSON strings, or legacy
 *  shapes produced when the voice model serialises the sub-object as text. */
function normaliseScheduleConfig(
  scheduleType: string,
  raw: unknown,
): { value: Record<string, unknown> } | { error: string } {
  let config: Record<string, unknown> = {};
  if (raw && typeof raw === "object") {
    config = raw as Record<string, unknown>;
  } else if (typeof raw === "string" && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") config = parsed as Record<string, unknown>;
    } catch {
      // Treat bare cron expressions as the raw expression ("0 9 * * 1").
      if (scheduleType === "cron") config = { expression: raw };
    }
  }

  switch (scheduleType) {
    case "once":
      return { value: {} };
    case "cron": {
      const expr = String(config.expression ?? "").trim();
      if (!expr || expr.split(/\s+/).length < 5) {
        return { error: "cron schedule requires expression in '<m h dom mon dow>' form" };
      }
      return { value: { expression: expr } };
    }
    case "interval": {
      // Accept both the documented { value, unit } and the legacy { amount, unit }
      // / { minutes } shapes — the scheduler handles all three.
      const unit = String(config.unit ?? "minutes");
      const rawValue = config.value ?? config.amount ?? config.minutes;
      const num = typeof rawValue === "number" ? rawValue : Number(rawValue);
      if (!Number.isFinite(num) || num <= 0) {
        return { error: "interval schedule requires a positive numeric value" };
      }
      return { value: { value: num, unit } };
    }
    default:
      return { error: `unsupported scheduleType: ${scheduleType}` };
  }
}

async function archiveJob(args: Args, userId: string): Promise<unknown> {
  const jobId = String(args.jobId ?? "");
  if (!jobId) return { error: "jobId is required" };
  const { data, error } = await getSupabase()
    .from("jobs")
    .update({ is_archived: true, updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) return { error: error.message };
  return { job: data };
}

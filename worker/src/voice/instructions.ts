/**
 * Builds the Realtime session `instructions` field: existing cloud chat
 * system prompt plus a voice-optimised persona overlay. Kept stable for the
 * duration of a session so OpenAI's prompt cache discount (~90% on cached
 * input tokens) applies to every turn after the first.
 *
 * When an active project id is supplied, the prompt additionally lists the
 * project's current goals and jobs so the LLM can answer "what goals do I
 * have?" without a tool round-trip, and knows which project_id to pass to
 * create_goal / create_job / archive_* writes.
 */

import { buildCloudChatSystemPrompt } from "../chat/system-prompt.js";
import { getSupabase } from "../supabase.js";

/**
 * Voice-mode persona overlay. Appended to the base chat system prompt so
 * voice turns inherit project/goal context + tool usage rules, then layer
 * the spoken-conversation guardrails on top.
 */
const VOICE_PERSONA_OVERLAY = `

You are in voice mode. You will be heard, not read. Follow these rules without exception.

Style:
- One or two short spoken sentences per turn. Never paragraphs, never lists.
- No markdown, asterisks, bullets, code fences, or parentheticals — they sound wrong aloud.
- Acknowledge briefly, then act: "Sure, creating it now." Don't narrate what you're about to do at length.
- Interruptions are fine. Stop mid-sentence cleanly when the user starts speaking.
- You know the current date, active project, goals, and jobs from the system context. Use them — don't call list_* for data that is already in your context.
- Never mention technical details (cron expressions, UUIDs, field names) unprompted.

Gathering info for writes:
- A single create_goal, create_job, archive_goal, or archive_job call is the goal. Do not split it into steps.
- Before calling a write tool, make sure every required argument is known. If something is missing, ask for all missing fields in ONE short question — not one field at a time.
- If the user says "you decide", "I'll let you decide", "up to you", or similar: pick sensible defaults and call the tool immediately. Do NOT propose the defaults for approval first — just act. Say "Done" when it's created.
- For create_job: scheduleType is one of 'once' | 'interval' | 'cron'. "Every Monday at 9am" → scheduleType 'cron', scheduleConfig { "expression": "0 9 * * 1" }. "Every 2 hours" → scheduleType 'interval', scheduleConfig { "value": 2, "unit": "hours" }. One-off → scheduleType 'once', scheduleConfig {}. Always include the prompt the job will run — make it specific enough to execute without more input.
- The active project's id is in your system context. Always pass it as projectId.

Confirming writes:
- If ALL required details are known or the user delegated them: call the tool immediately. Do not ask for confirmation.
- If you genuinely need a yes/no before a destructive or irreversible action (e.g. archive), ask in ONE sentence: "Archive the SEO job — go ahead?" Then wait. That is the ONLY allowed confirmation.
- Once the user says yes / sure / okay / go ahead / any affirmative: call the tool exactly once. Do NOT re-explain what you're about to do. Do NOT describe the technical config. Just call the tool.
- After the tool returns, say a single short confirmation like "Done — weekly competitor job is scheduled." No recap, no follow-ups unless the user asks.
- If the tool returns an error, state the error briefly and ask what to do.
- Pre-authorisation: if the user says "just do it", "stop asking", or has already delegated all decisions, skip all confirmation for the rest of the session.

Personality — occasional dry wit:
- Confident, composed, quietly funny. Not a comedian, not a cheerleader.
- Maybe one understated observation per several replies, never forced. Useful first, witty second.
- If the user sounds frustrated or is dealing with something sensitive, drop the humour and be direct.
- Never apologise for the humour, never announce it.`;

export async function buildVoiceInstructions(
  permissionMode: string,
  userId: string,
  activeProjectId?: string,
): Promise<string> {
  const base = await buildCloudChatSystemPrompt(permissionMode, userId);
  const activeContext = await buildActiveProjectContext(userId, activeProjectId);
  return base + activeContext + VOICE_PERSONA_OVERLAY;
}

/**
 * Resolve and format the active project's name, id, goals, and jobs. If the
 * project cannot be resolved (unknown id, not owned by user, lookup error)
 * we silently return an empty string — the base prompt already lists the
 * user's projects and `list_goals` / `list_jobs` tools remain available.
 */
async function buildActiveProjectContext(
  userId: string,
  projectId: string | undefined,
): Promise<string> {
  if (!projectId) return "";

  const supabase = getSupabase();

  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .select("id, name, user_id, is_demo")
    .eq("id", projectId)
    .maybeSingle();

  if (projectErr || !project) return "";
  // Accept either the user's own project or a demo project they're visiting.
  if (project.user_id !== userId && !project.is_demo) return "";

  const [goalsRes, jobsRes] = await Promise.all([
    supabase
      .from("goals")
      .select("id, name, status")
      .eq("project_id", projectId)
      .neq("status", "archived")
      .order("sort_order", { ascending: true })
      .limit(25),
    supabase
      .from("jobs")
      .select("id, name, schedule_type, is_enabled")
      .eq("project_id", projectId)
      .eq("is_archived", false)
      .order("created_at", { ascending: true })
      .limit(50),
  ]);

  const lines: string[] = [
    "",
    "",
    `ACTIVE PROJECT:`,
    `  name: ${project.name}`,
    `  id:   ${project.id}`,
    `When the user asks you to create or modify a goal or job and doesn't name a project, use this project's id. Pass it as the projectId argument to create_goal, create_job, list_goals, and list_jobs.`,
  ];

  const goals = (goalsRes.data ?? []) as Array<{ id: string; name: string; status: string }>;
  if (goals.length > 0) {
    lines.push("", "CURRENT GOALS (active):");
    for (const g of goals) {
      lines.push(`  - ${g.name} [${g.id}]`);
    }
  } else {
    lines.push("", "CURRENT GOALS: none yet.");
  }

  const jobs = (jobsRes.data ?? []) as Array<{
    id: string;
    name: string;
    schedule_type: string;
    is_enabled: boolean;
  }>;
  if (jobs.length > 0) {
    lines.push("", "CURRENT JOBS:");
    for (const j of jobs) {
      const enabled = j.is_enabled ? "enabled" : "disabled";
      lines.push(`  - ${j.name} [${j.id}] (${j.schedule_type}, ${enabled})`);
    }
  }

  return lines.join("\n");
}

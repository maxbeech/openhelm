/**
 * Builds the chat system prompt for cloud-mode chat.
 *
 * The prompt advertises the available tools (so the LLM knows to use
 * web_search/web_fetch instead of refusing factual queries), and injects
 * a brief summary of the user's projects as context.
 */

import { getSupabase } from "../supabase.js";

const BASE_PROMPT = `You are OpenHelm's chat assistant. OpenHelm turns high-level goals into scheduled, self-correcting automated jobs.

You have access to tools. Use them proactively:
- web_search and web_fetch: Use these whenever the user asks a factual question, references a website, or when you need current information. NEVER reply "I can't browse the internet" — you can, via these tools.
- list_projects / list_goals / list_jobs / list_runs / get_run_logs: Read the user's OpenHelm data to answer questions about their projects, goals, jobs, and run history.

Rules:
- When the user asks about a website or factual topic, call web_search or web_fetch first, then answer based on the results.
- Keep replies concise and directly answer the user's question.
- Never fabricate data about the user's jobs or runs — call the appropriate list_* tool first.
- If a tool returns an error, explain it briefly and try a reasonable alternative or ask the user for clarification.`;

const FULL_ACCESS_EXTRA = `

You also have write tools available (create_goal, archive_goal, create_job, archive_job). Use them when the user explicitly asks you to create or modify their data. Confirm the action was successful by referencing the returned object.`;

export async function buildCloudChatSystemPrompt(
  permissionMode: string,
  userId: string,
): Promise<string> {
  const parts: string[] = [BASE_PROMPT];
  if (permissionMode === "bypassPermissions") {
    parts.push(FULL_ACCESS_EXTRA);
  }

  // Brief project summary for context (best-effort — don't fail the chat on error)
  try {
    const { data } = await getSupabase()
      .from("projects")
      .select("id, name")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (data && data.length > 0) {
      const list = data.map((p) => `- ${p.name} (${p.id})`).join("\n");
      parts.push(`\n\nThe user's projects:\n${list}`);
    }
  } catch {
    // swallow — context enrichment is non-critical
  }

  return parts.join("");
}

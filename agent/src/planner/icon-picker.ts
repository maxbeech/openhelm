/**
 * icon-picker.ts — Uses the LLM (haiku) to pick a suitable icon name
 * for a goal or job based on its name and description.
 *
 * Returns one of the valid ICON_NAMES keys (used by the frontend NodeIcon
 * component). Runs in the background after creation — never blocks.
 */

import { callLlmViaCli } from "./llm-via-cli.js";

/**
 * Valid icon names — must stay in sync with src/lib/icon-map.ts in the
 * frontend. The LLM must return exactly one of these strings.
 */
const VALID_ICONS = [
  "activity", "alert", "chart", "bell", "book", "box", "briefcase", "bug",
  "building", "check", "clipboard", "cloud", "code", "cpu", "database", "eye",
  "file", "flag", "flask", "folder", "globe", "hard_drive", "hash", "key",
  "layers", "line_chart", "link", "lock", "mail", "message", "network",
  "package", "paintbrush", "play", "refresh", "rocket", "search", "server",
  "settings", "shield", "star", "tag", "target", "timer", "trending",
  "trophy", "users", "wrench", "zap",
] as const;

const SYSTEM_PROMPT = `You are an icon selector for a developer task management tool. Given a name and optional description for a task or goal, respond with a single icon name from the allowed list.

Allowed icon names:
${VALID_ICONS.join(", ")}

Rules:
- Return ONLY the icon name, nothing else — no quotes, no punctuation
- Pick the icon that best represents the concept visually
- For code-related work, prefer: code, bug, terminal (use "code")
- For data/storage, prefer: database, hard_drive
- For infrastructure, prefer: server, cloud, network
- For testing, prefer: flask, check
- For performance/metrics, prefer: chart, activity, trending, zap
- For security, prefer: shield, lock, key
- For documentation, prefer: book, file, clipboard
- For goals/milestones, prefer: target, rocket, trophy, flag
- For organisation/people, prefer: users, building
- Never return text outside the allowed list`;

/**
 * Ask the LLM to pick a single icon name for the given name/description.
 * Returns the icon name string, or null if the call fails.
 */
export async function pickIcon(
  name: string,
  description?: string | null,
): Promise<string | null> {
  try {
    const userMessage = description
      ? `Name: ${name}\nDescription: ${description}`
      : `Name: ${name}`;

    const { text: result } = await callLlmViaCli({
      model: "classification",
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      timeoutMs: 30_000,
    });

    const iconName = result.trim().toLowerCase();
    if ((VALID_ICONS as readonly string[]).includes(iconName)) {
      return iconName;
    }
    console.error(`[icon-picker] invalid icon returned: "${iconName}"`);
    return null;
  } catch (err) {
    console.error(
      `[icon-picker] failed:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

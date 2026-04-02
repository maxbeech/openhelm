/**
 * Reads Claude Code conversation JSONL files from ~/.claude/projects/ to extract
 * token usage data across all Claude Code sessions (not just OpenHelm-initiated ones).
 *
 * Deduplication: JSONL files store both a streaming-start placeholder entry (low tokens,
 * null stop_reason) and a final completed entry for each assistant turn. We skip any
 * assistant entry whose UUID appears as the parentUuid of another assistant entry —
 * those are streaming starts, not final turns.
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import os from "os";

export interface DailyUsage {
  /** UTC date YYYY-MM-DD */
  date: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  sonnetInputTokens: number;
  sonnetOutputTokens: number;
  /** Session IDs contributing to this day's usage */
  sessionIds: Set<string>;
}

interface AssistantEntry {
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

/** Return the YYYY-MM-DD (UTC) for an ISO timestamp string */
function isoToUtcDate(ts: string): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Return true if the model string indicates a Sonnet variant */
function isSonnet(model: string): boolean {
  return model.toLowerCase().includes("sonnet");
}

/**
 * Read all JSONL files under ~/.claude/projects/ modified within the past `maxAgeMs`
 * milliseconds and aggregate token usage by UTC day.
 *
 * Only files within maxAgeMs are scanned (performance guard). Defaults to 9 days
 * to cover the current week + some buffer.
 */
export async function readClaudeUsageByDate(
  maxAgeMs = 9 * 24 * 60 * 60 * 1000,
): Promise<Map<string, DailyUsage>> {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    return new Map();
  }

  const cutoff = Date.now() - maxAgeMs;
  const jsonlFiles = await findRecentJsonlFiles(CLAUDE_PROJECTS_DIR, cutoff);

  const byDate = new Map<string, DailyUsage>();

  for (const filePath of jsonlFiles) {
    try {
      const entries = await parseJsonlFile(filePath);
      mergeEntries(entries, byDate);
    } catch {
      // Skip unreadable / malformed files silently
    }
  }

  return byDate;
}

/** Recursively find all .jsonl files modified after `cutoff` epoch ms (async — avoids blocking the event loop) */
async function findRecentJsonlFiles(dir: string, cutoff: number): Promise<string[]> {
  const results: string[] = [];

  async function recurse(current: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await recurse(full);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          try {
            const stat = await fs.promises.stat(full);
            if (stat.mtimeMs >= cutoff) {
              results.push(full);
            }
          } catch {
            // ignore stat errors
          }
        }
      }),
    );
  }

  await recurse(dir);
  return results;
}

/** Parse a single JSONL file and return deduplicated assistant entries */
async function parseJsonlFile(filePath: string): Promise<AssistantEntry[]> {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const raw: AssistantEntry[] = [];

  try {
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (obj.type !== "assistant") continue;

    const msg = obj.message as Record<string, unknown> | undefined;
    if (!msg) continue;

    const usage = msg.usage as Record<string, number> | undefined;
    if (!usage) continue;

    const ts = typeof obj.timestamp === "string" ? obj.timestamp : "";
    if (!ts) continue;

    raw.push({
      uuid: typeof obj.uuid === "string" ? obj.uuid : "",
      parentUuid: typeof obj.parentUuid === "string" ? obj.parentUuid : null,
      sessionId: typeof obj.sessionId === "string" ? obj.sessionId : "",
      timestamp: ts,
      inputTokens: (usage.input_tokens ?? 0) as number,
      // Cache tokens excluded: cache_creation and cache_read represent cached context
      // mechanics, not meaningful token consumption — including them inflates counts by ~400x.
      outputTokens: (usage.output_tokens ?? 0) as number,
      model: typeof msg.model === "string" ? msg.model : "",
    });
  }

  } finally {
    // Explicitly close the readline interface to release the file descriptor
    // promptly, even if the loop exits early via a thrown error.
    rl.close();
  }

  // Deduplicate: skip streaming-start placeholders.
  // A streaming-start entry is any assistant entry whose UUID appears as the
  // parentUuid of another assistant entry in the same file.
  const parentedUuids = new Set(
    raw.map((e) => e.parentUuid).filter((p): p is string => p !== null),
  );
  return raw.filter((e) => !parentedUuids.has(e.uuid));
}

/** Merge deduplicated entries into the per-date map */
function mergeEntries(
  entries: AssistantEntry[],
  byDate: Map<string, DailyUsage>,
): void {
  for (const entry of entries) {
    const date = isoToUtcDate(entry.timestamp);

    let daily = byDate.get(date);
    if (!daily) {
      daily = {
        date,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        sonnetInputTokens: 0,
        sonnetOutputTokens: 0,
        sessionIds: new Set(),
      };
      byDate.set(date, daily);
    }

    daily.totalInputTokens += entry.inputTokens;
    daily.totalOutputTokens += entry.outputTokens;

    if (isSonnet(entry.model)) {
      daily.sonnetInputTokens += entry.inputTokens;
      daily.sonnetOutputTokens += entry.outputTokens;
    }

    if (entry.sessionId) {
      daily.sessionIds.add(entry.sessionId);
    }
  }
}

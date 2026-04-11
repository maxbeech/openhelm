/**
 * Run Summarisation — generates a plain-English summary of a completed run.
 *
 * Uses a single CLI call to Haiku via --print mode. Invoked by the executor
 * after a run reaches a terminal state, before the statusChanged event is emitted.
 *
 * Summarisation failures must never affect run status or system stability.
 */

import { listRunLogs } from "../db/queries/run-logs.js";
import { callLlmViaCli } from "./llm-via-cli.js";
import { PrintError } from "../agent-backend/errors.js";
import type { RunStatus } from "@openhelm/shared";

const MAX_LOG_CHARS = 8_000;

const SUMMARIZE_SYSTEM_PROMPT = `You summarise the output of automated coding runs for a desktop app called OpenHelm.

Given the run status and the run's log output, write a 2–3 sentence plain-English summary:
- Whether the run succeeded or failed
- What was accomplished or what went wrong
- Any important action items for the user

Rules:
- Never include raw error codes, stack traces, or file paths verbatim — those are available in the log viewer.
- Be concise and helpful — a busy developer should understand the outcome at a glance.
- Respond with ONLY the summary text. No prefixes like "Summary:" or markdown formatting.`;

/** Truncate log text to the last MAX_LOG_CHARS, keeping the end (where results and errors appear) */
export function truncateLogs(fullText: string): string {
  if (fullText.length <= MAX_LOG_CHARS) return fullText;
  return (
    "[Earlier output was truncated — showing the final portion of the run output]\n" +
    fullText.slice(-MAX_LOG_CHARS)
  );
}

const ANALYSIS_HEAD_CHARS = 4_000;
const ANALYSIS_TAIL_CHARS = 20_000;
const ANALYSIS_MAX_CHARS = ANALYSIS_HEAD_CHARS + ANALYSIS_TAIL_CHARS;

/**
 * Truncate logs for failure analysis using a head+tail strategy.
 * Keeps the first 4K chars (what was accomplished early) + last 20K chars
 * (where the failure occurred). Total budget: ~24K chars.
 */
export function truncateLogsForAnalysis(fullText: string): string {
  if (fullText.length <= ANALYSIS_MAX_CHARS) return fullText;
  const head = fullText.slice(0, ANALYSIS_HEAD_CHARS);
  const tail = fullText.slice(-ANALYSIS_TAIL_CHARS);
  return (
    head +
    "\n\n[… middle portion truncated — showing beginning and end of run output …]\n\n" +
    tail
  );
}

/** Collect all log chunks for a run into a single string */
export function collectRunLogs(runId: string): string {
  const logs = listRunLogs({ runId });
  return logs.map((l) => l.text).join("");
}

/**
 * Generate a plain-English summary for a completed run.
 * Returns null if summarisation fails for any reason.
 */
export async function generateRunSummary(
  runId: string,
  status: RunStatus,
): Promise<string | null> {
  try {
    const fullText = collectRunLogs(runId);
    if (!fullText.trim()) {
      return status === "succeeded"
        ? "Run completed successfully with no output."
        : "Run ended with no output captured.";
    }

    const truncated = truncateLogs(fullText);
    const userMessage = `Run status: ${status}\n\nRun output:\n${truncated}`;

    const { text } = await callLlmViaCli({
      model: "classification",
      systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
      userMessage,
    });

    return text.trim() || null;
  } catch (err) {
    // Log the failure but never propagate — summarisation is best-effort
    const message = err instanceof PrintError ? err.message : String(err);
    console.error(`[summariser] failed for run ${runId}: ${message}`);
    return null;
  }
}

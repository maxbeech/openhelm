/**
 * Failure Analyzer — examines a failed run's logs and determines whether
 * the failure is fixable with additional guidance.
 *
 * Uses Haiku via --print mode (classification tier) with --json-schema
 * to guarantee structured JSON output. Follows the same pattern as assess.ts.
 * Returns null if analysis fails for any reason.
 */

import { collectRunLogs, truncateLogsForAnalysis } from "./summarize.js";
import { callLlmViaCli } from "./llm-via-cli.js";
import { extractJson } from "./extract-json.js";
import { FAILURE_ANALYSIS_SCHEMA } from "./schemas.js";
import { PrintError } from "../claude-code/print.js";

export interface FailureAnalysis {
  fixable: boolean;
  correction: string | null; // persistent job-level guidance for future fresh runs
  continuationPrompt: string | null; // follow-up message for resuming the failed session
  reason: string; // human-readable explanation
}

const FAILURE_ANALYSIS_SYSTEM_PROMPT = `You analyze failed automated coding runs for a desktop app called OpenHelm.

Given the original task prompt and the run's log output, determine:
1. Whether the failure is fixable with additional guidance
2. If fixable, provide TWO separate outputs:
   a. "correction": persistent job-level guidance for future fresh runs (2-5 sentences). Describes what went wrong and how to avoid it.
   b. "continuationPrompt": a follow-up message for RESUMING the failed session (2-5 sentences). This will be sent as a new message in the same conversation. Reference what was already done, acknowledge the failure, and direct the next steps. Do NOT repeat the original task — the session already has that context.
3. A brief reason explaining your classification

FIXABLE examples: code logic errors, wrong file paths, missing imports, wrong approach that can be guided, incorrect assumptions about the codebase.
NOT FIXABLE examples: missing credentials/permissions, infrastructure issues (network, disk), fundamentally impossible tasks, missing dependencies that require manual installation.
POTENTIALLY FIXABLE — timeouts: If the run timed out (was forcibly terminated after its time limit), the task was likely partially completed. Analyze the logs to determine what was already done, then provide correction guidance that: (1) tells the next run what was already completed so it can skip those steps, (2) suggests a more efficient approach for the remaining work (e.g., "Search by name instead of scrolling to position 34", "Use the API instead of browser automation"). Be specific based on the actual logs.
POTENTIALLY FIXABLE — silence timeouts: If the run was killed due to no output for an extended period, this often means Claude got stuck on one approach (e.g., browser login flow, unresponsive service). Provide correction guidance steering toward an alternative approach (e.g., use API calls instead of browser automation, skip authentication flows that require human input).

When fixable, the correction should be specific, actionable guidance that addresses the root cause. Do NOT repeat the original prompt — only describe what went wrong and how to fix it.`;

/**
 * Analyze a failed run and determine if it's fixable.
 * Returns null if analysis fails for any reason.
 */
export interface PreviousAttemptInfo {
  correctionNote: string | null;
  summary: string | null;
}

export async function analyzeFailure(
  runId: string,
  originalPrompt: string,
  failureContext?: string,
  previousAttempts?: PreviousAttemptInfo[],
): Promise<FailureAnalysis | null> {
  try {
    const fullText = collectRunLogs(runId);
    if (!fullText.trim()) {
      return { fixable: false, correction: null, continuationPrompt: null, reason: "No output captured from the failed run." };
    }

    const truncated = truncateLogsForAnalysis(fullText);
    const contextSection = failureContext ? `\n\nFailure context:\n${failureContext}` : "";
    const previousSection = buildPreviousAttemptsSection(previousAttempts);
    const userMessage = `Original task prompt:\n${originalPrompt}${contextSection}${previousSection}\n\nRun output (failed):\n${truncated}`;

    const { text } = await callLlmViaCli({
      model: "classification",
      systemPrompt: FAILURE_ANALYSIS_SYSTEM_PROMPT,
      userMessage,
      timeoutMs: 60_000,
      jsonSchema: FAILURE_ANALYSIS_SCHEMA,
    });

    const jsonStr = extractJson(text);
    const parsed = JSON.parse(jsonStr) as FailureAnalysis;

    // Basic validation
    if (typeof parsed.fixable !== "boolean" || typeof parsed.reason !== "string") {
      console.error(`[failure-analyzer] invalid response shape`);
      return null;
    }

    return {
      fixable: parsed.fixable,
      correction: parsed.fixable ? (parsed.correction ?? null) : null,
      continuationPrompt: parsed.fixable ? (parsed.continuationPrompt ?? null) : null,
      reason: parsed.reason,
    };
  } catch (err) {
    const message = err instanceof PrintError ? err.message : String(err);
    console.error(`[failure-analyzer] failed for run ${runId}: ${message}`);
    return null;
  }
}

function buildPreviousAttemptsSection(attempts?: PreviousAttemptInfo[]): string {
  if (!attempts || attempts.length === 0) return "";
  const lines = attempts.map((a, i) => {
    const parts: string[] = [];
    if (a.correctionNote) parts.push(`Correction: ${a.correctionNote}`);
    if (a.summary) parts.push(`Result: ${a.summary}`);
    return `Attempt ${i + 1}: ${parts.join(" | ") || "(no details)"}`;
  });
  return `\n\nPrevious correction attempts that also failed (build on these — do NOT repeat the same corrections):\n${lines.join("\n")}`;
}

/**
 * Outcome Assessor — determines whether a run that exited cleanly (code 0)
 * actually accomplished its stated mission.
 *
 * Uses Haiku via --print mode with --json-schema for structured output.
 * Called by the executor after a run exits with code 0, BEFORE the summary
 * is generated. If the mission was not accomplished, the executor flips the
 * status to "failed" so the self-correction pipeline fires.
 *
 * Returns null on any error — the caller treats null as "assume succeeded".
 */

import { collectRunLogs, truncateLogsForAnalysis } from "./summarize.js";
import { callLlmViaCli } from "./llm-via-cli.js";
import { extractJson } from "./extract-json.js";
import { OUTCOME_ASSESSMENT_SCHEMA } from "./schemas.js";
import { PrintError } from "../agent-backend/errors.js";

export interface OutcomeAssessment {
  accomplished: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
}

const OUTCOME_SYSTEM_PROMPT = `You assess whether an automated task accomplished its stated objective.

Given the task prompt and run output (exit code 0 — no crash), determine if the mission was met.

Evidence of SUCCESS:
- Task deliverables were produced (files written, data posted, content created)
- Confirmation messages from the target system (e.g. "posted successfully", "login successful")
- The agent completed all steps described in the prompt

Evidence of FAILURE:
- Login/authentication failures (wrong password, anti-bot blocks, CAPTCHA)
- "Unable to", "could not", "blocked", "denied", "failed to" in the agent's conclusions
- The agent asked the user for help or credentials it couldn't access
- The agent gave up and suggested manual alternatives
- Partial completion where the core deliverable was not produced
- The agent pivoted to a DIFFERENT target platform than the one the prompt
  named (e.g. the prompt said "post on X.com" but the agent ended up posting
  on Hacker News because X.com was blocked). This is a failure with HIGH
  confidence regardless of how much work was done on the substitute platform.

Confidence levels:
- high: clear evidence of success or failure
- medium: reasonable inference from context
- low: ambiguous — could go either way

CRITICAL: When in doubt, lean toward accomplished: true. False negatives (marking a success as failure) cause unnecessary retries and waste resources.`;

/**
 * Assess whether a run's mission was accomplished despite exiting with code 0.
 * Returns null if assessment fails for any reason (caller assumes succeeded).
 */
export async function assessOutcome(
  runId: string,
  jobPrompt: string,
): Promise<OutcomeAssessment | null> {
  try {
    const fullText = collectRunLogs(runId);
    if (!fullText.trim()) {
      // No output — can't assess, assume succeeded
      return null;
    }

    const truncated = truncateLogsForAnalysis(fullText);
    const userMessage = `Task objective:\n${jobPrompt}\n\nRun output (exit code 0):\n${truncated}`;

    const { text } = await callLlmViaCli({
      model: "classification",
      systemPrompt: OUTCOME_SYSTEM_PROMPT,
      userMessage,
      timeoutMs: 60_000,
      jsonSchema: OUTCOME_ASSESSMENT_SCHEMA,
    });

    const jsonStr = extractJson(text);
    const parsed = JSON.parse(jsonStr) as OutcomeAssessment;

    if (typeof parsed.accomplished !== "boolean" || typeof parsed.reason !== "string") {
      console.error("[outcome-assessor] invalid response shape");
      return null;
    }

    return {
      accomplished: parsed.accomplished,
      confidence: parsed.confidence ?? "low",
      reason: parsed.reason,
    };
  } catch (err) {
    const message = err instanceof PrintError ? err.message : String(err);
    console.error(`[outcome-assessor] failed for run ${runId}: ${message}`);
    return null;
  }
}

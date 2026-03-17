/**
 * Correction Evaluator — after a successful run, evaluates whether the
 * job's correction note is still needed, should be modified, or removed.
 *
 * Uses Haiku via --print mode (classification tier) with --json-schema.
 * Returns null if evaluation fails (caller should keep the note as-is).
 */

import { collectRunLogs, truncateLogsForAnalysis } from "./summarize.js";
import { callLlmViaCli } from "./llm-via-cli.js";
import { extractJson } from "./extract-json.js";
import { CORRECTION_EVALUATION_SCHEMA } from "./schemas.js";
import { PrintError } from "../claude-code/print.js";

export interface CorrectionEvaluation {
  action: "keep" | "modify" | "remove";
  modifiedNote?: string;
  reason: string;
}

const SYSTEM_PROMPT = `You evaluate whether a correction note on a job is still needed after a successful run.

A correction note was added after a previous failure to guide future runs. Now that a run has succeeded, decide:
- "remove": The issue is fully resolved and the note is no longer needed.
- "modify": The note is partially relevant but should be updated (provide modifiedNote).
- "keep": The note contains guidance that remains relevant for future runs.

Default to "remove" if the successful run clearly addressed the issue.
Only "keep" if the note contains persistent guidance beyond the specific fix.`;

export async function evaluateCorrectionNote(
  runId: string,
  jobPrompt: string,
  correctionNote: string,
): Promise<CorrectionEvaluation | null> {
  try {
    const fullText = collectRunLogs(runId);
    const truncated = truncateLogsForAnalysis(fullText);

    const userMessage = `Job prompt:\n${jobPrompt}\n\nCorrection note:\n${correctionNote}\n\nSuccessful run output:\n${truncated}`;

    const text = await callLlmViaCli({
      model: "classification",
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      timeoutMs: 60_000,
      jsonSchema: CORRECTION_EVALUATION_SCHEMA,
    });

    const jsonStr = extractJson(text);
    const parsed = JSON.parse(jsonStr) as CorrectionEvaluation;

    if (!["keep", "modify", "remove"].includes(parsed.action)) {
      console.error(`[correction-evaluator] invalid action: ${parsed.action}`);
      return null;
    }

    return {
      action: parsed.action,
      modifiedNote: parsed.action === "modify" ? (parsed.modifiedNote ?? undefined) : undefined,
      reason: parsed.reason,
    };
  } catch (err) {
    const message = err instanceof PrintError ? err.message : String(err);
    console.error(`[correction-evaluator] failed for run ${runId}: ${message}`);
    return null;
  }
}

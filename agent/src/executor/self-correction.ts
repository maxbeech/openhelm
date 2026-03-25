/**
 * Self-Correction Engine — orchestrates the decision to create a corrective
 * run after a failed run. Guarantees at most 1 retry per failure event.
 *
 * Two-tier retry logic:
 * - Tier 1 (signal-based): timeouts & silence kills ALWAYS retry. LLM is used
 *   only for correction text; if LLM fails, a generic fallback is used.
 * - Tier 2 (LLM-decision): all other failures. LLM decides fixability.
 *   If LLM fails, returns analysisError (caller decides what to do).
 *
 * Loop prevention: corrective runs that fail are NOT retried.
 */

import { getRun, createRun, hasCorrectiveRun, getCorrectionChainDepth } from "../db/queries/runs.js";
import { getJob, updateJobCorrectionNote } from "../db/queries/jobs.js";
import { getSetting } from "../db/queries/settings.js";
import { analyzeFailure } from "../planner/failure-analyzer.js";
import { emit } from "../ipc/emitter.js";
import type { QueueItem } from "../scheduler/queue.js";
import type { Job, Run } from "@openhelm/shared";

const DEFAULT_MAX_RETRIES = 2;

export interface FailureSignal {
  isTimeout: boolean;         // runner's timedOut OR exit code 143/137
  isSilenceTimeout: boolean;  // HITL silence kill
  exitCode: number | null;
  timeoutMinutes?: number;
  failureContext?: string;    // human-readable context for the LLM
}

export interface SelfCorrectionResult {
  attempted: boolean;
  correctiveRunId?: string;
  reason: string;
  notFixable?: boolean;
  analysisReason?: string;
  /** True when the LLM analysis call itself failed (returned null) */
  analysisError?: boolean;
  /** True when the failed run is a corrective run that itself failed — should be triaged as permanent_failure */
  shouldTriage?: boolean;
}

/** Build generic fallback correction when LLM analysis fails for a retryable signal */
export function buildFallbackCorrection(signal: FailureSignal): string {
  if (signal.isSilenceTimeout) {
    return "Previous run stalled (no output for an extended period). Try a different approach for the part where it got stuck. Avoid interactive flows or browser login steps that require human input.";
  }
  const mins = signal.timeoutMinutes ?? 30;
  return `Previous run timed out after ${mins} minutes. Check project state, skip any steps that were already completed, and use a more efficient approach to complete the remaining work.`;
}

/** Build generic fallback continuation prompt for session resumption */
export function buildFallbackContinuationPrompt(signal: FailureSignal): string {
  if (signal.isSilenceTimeout) {
    return "The previous attempt stalled with no output for an extended period and was terminated. Review what you accomplished so far, then try a different approach for the part where you got stuck. Avoid interactive flows or steps that require human input.";
  }
  const mins = signal.timeoutMinutes ?? 30;
  return `The previous attempt was terminated after ${mins} minutes. Review what you already accomplished, skip completed steps, and use a more efficient approach to finish the remaining work.`;
}

export async function attemptSelfCorrection(
  failedRunId: string,
  job: Job,
  enqueueFn: (item: QueueItem) => void,
  failureSignal?: FailureSignal,
): Promise<SelfCorrectionResult> {
  // 1. Check autopilot mode (default full_auto — self-correction enabled)
  const autopilotMode = getSetting("autopilot_mode");
  if (autopilotMode?.value === "off") {
    return { attempted: false, reason: "Autopilot is off — self-correction disabled" };
  }

  // 2. Check correction chain depth — respect max retries setting
  const failedRun = getRun(failedRunId);
  if (!failedRun) {
    return { attempted: false, reason: "Failed run not found" };
  }
  const maxRetriesSetting = getSetting("max_correction_retries");
  const maxRetries = maxRetriesSetting ? parseInt(maxRetriesSetting.value, 10) : DEFAULT_MAX_RETRIES;
  const depth = getCorrectionChainDepth(failedRunId);
  if (depth >= maxRetries) {
    return { attempted: false, reason: `Max correction retries reached (${depth}/${maxRetries}) — escalating to permanent failure`, shouldTriage: true };
  }

  // 3. Check duplicate guard
  if (hasCorrectiveRun(failedRunId)) {
    return { attempted: false, reason: "Corrective run already exists" };
  }

  // Determine if this is a signal-based (Tier 1) retry
  const isSignalRetry = failureSignal?.isTimeout || failureSignal?.isSilenceTimeout;

  // Collect previous correction attempts for cumulative analysis
  const previousAttempts = collectPreviousAttempts(failedRun);

  // 4. Analyze the failure via LLM
  console.error(`[self-correction] analyzing failure for run ${failedRunId} (depth ${depth}/${maxRetries})`);
  const analysis = await analyzeFailure(failedRunId, job.prompt, failureSignal?.failureContext, previousAttempts);

  // 5. Decide retry based on tier
  let correctionText: string;
  let continuationPrompt: string | null = null;

  if (isSignalRetry) {
    // Tier 1: ALWAYS retry. Use LLM correction if available, else fallback.
    if (analysis?.fixable && analysis.correction) {
      correctionText = analysis.correction;
      continuationPrompt = analysis.continuationPrompt ?? null;
    } else {
      correctionText = buildFallbackCorrection(failureSignal!);
      continuationPrompt = failedRun.sessionId
        ? buildFallbackContinuationPrompt(failureSignal!)
        : null;
      console.error(`[self-correction] using fallback correction for signal-based retry`);
    }
  } else {
    // Tier 2: LLM decides fixability
    if (!analysis) {
      return { attempted: false, reason: "Failure analysis failed (LLM call error)", analysisError: true };
    }
    if (!analysis.fixable || !analysis.correction) {
      return {
        attempted: false,
        reason: `Not fixable: ${analysis.reason}`,
        notFixable: true,
        analysisReason: analysis.reason,
      };
    }
    correctionText = analysis.correction;
    continuationPrompt = analysis.continuationPrompt ?? null;
  }

  // 6. Set correction note on the job (persistent for future runs)
  updateJobCorrectionNote(job.id, correctionText);
  emit("job.updated", { jobId: job.id });

  // 7. Create corrective run
  // If parent has a sessionId and we have a continuation prompt, store it
  // as the corrective run's correctionNote (executor uses it as the resume prompt).
  // Otherwise, store the regular correction text for fresh-run behavior.
  const hasResumableSession = !!failedRun.sessionId;
  const runCorrectionNote = hasResumableSession && continuationPrompt
    ? continuationPrompt
    : correctionText;

  const correctiveRun = createRun({
    jobId: job.id,
    triggerSource: "corrective",
    parentRunId: failedRunId,
    correctionNote: runCorrectionNote,
  });

  console.error(`[self-correction] created corrective run ${correctiveRun.id} for failed run ${failedRunId}`);

  emit("run.created", { runId: correctiveRun.id, jobId: job.id });
  emit("run.statusChanged", {
    runId: correctiveRun.id,
    status: "queued",
    previousStatus: "queued",
  });

  // 9. Enqueue at priority 2 (corrective)
  enqueueFn({
    runId: correctiveRun.id,
    jobId: job.id,
    priority: 2,
    enqueuedAt: Date.now(),
  });

  return {
    attempted: true,
    correctiveRunId: correctiveRun.id,
    reason: analysis?.reason ?? "Signal-based retry (timeout/silence)",
  };
}

export interface PreviousAttempt {
  correctionNote: string | null;
  summary: string | null;
}

/**
 * Walk the correction chain to collect previous correction attempts
 * (most recent first). Includes the current run if it's corrective,
 * then walks ancestors. Used for cumulative failure analysis.
 */
function collectPreviousAttempts(run: Run): PreviousAttempt[] {
  const attempts: PreviousAttempt[] = [];
  // Include the current run if it was itself a correction attempt
  if (run.triggerSource === "corrective" && (run.correctionNote || run.summary)) {
    attempts.push({ correctionNote: run.correctionNote, summary: run.summary });
  }
  // Walk ancestors
  let currentId = run.parentRunId;
  while (currentId && attempts.length < 5) {
    const parent = getRun(currentId);
    if (!parent) break;
    if (parent.triggerSource === "corrective" || parent.correctionNote) {
      attempts.push({
        correctionNote: parent.correctionNote,
        summary: parent.summary,
      });
    }
    currentId = parent.parentRunId;
  }
  return attempts;
}

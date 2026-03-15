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

import { getRun, createRun, hasCorrectiveRun } from "../db/queries/runs.js";
import { getJob, updateJobCorrectionContext } from "../db/queries/jobs.js";
import { getSetting } from "../db/queries/settings.js";
import { analyzeFailure } from "../planner/failure-analyzer.js";
import { emit } from "../ipc/emitter.js";
import type { QueueItem } from "../scheduler/queue.js";
import type { Job } from "@openorchestra/shared";

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
}

/** Build generic fallback correction when LLM analysis fails for a retryable signal */
export function buildFallbackCorrection(signal: FailureSignal): string {
  if (signal.isSilenceTimeout) {
    return "Previous run stalled (no output for an extended period). Try a different approach for the part where it got stuck. Avoid interactive flows or browser login steps that require human input.";
  }
  const mins = signal.timeoutMinutes ?? 30;
  return `Previous run timed out after ${mins} minutes. Check project state, skip any steps that were already completed, and use a more efficient approach to complete the remaining work.`;
}

export async function attemptSelfCorrection(
  failedRunId: string,
  job: Job,
  enqueueFn: (item: QueueItem) => void,
  failureSignal?: FailureSignal,
): Promise<SelfCorrectionResult> {
  // 1. Check setting (default enabled)
  const setting = getSetting("auto_correction_enabled");
  if (setting?.value === "false") {
    return { attempted: false, reason: "Auto-correction disabled in settings" };
  }

  // 2. Check trigger source — never auto-correct a corrective run
  const failedRun = getRun(failedRunId);
  if (!failedRun) {
    return { attempted: false, reason: "Failed run not found" };
  }
  if (failedRun.triggerSource === "corrective") {
    return { attempted: false, reason: "Corrective runs are not retried" };
  }

  // 3. Check duplicate guard
  if (hasCorrectiveRun(failedRunId)) {
    return { attempted: false, reason: "Corrective run already exists" };
  }

  // Determine if this is a signal-based (Tier 1) retry
  const isSignalRetry = failureSignal?.isTimeout || failureSignal?.isSilenceTimeout;

  // 4. Analyze the failure via LLM
  console.error(`[self-correction] analyzing failure for run ${failedRunId}`);
  const analysis = await analyzeFailure(failedRunId, job.prompt, failureSignal?.failureContext);

  // 5. Decide retry based on tier
  let correctionText: string;

  if (isSignalRetry) {
    // Tier 1: ALWAYS retry. Use LLM correction if available, else fallback.
    if (analysis?.fixable && analysis.correction) {
      correctionText = analysis.correction;
    } else {
      correctionText = buildFallbackCorrection(failureSignal!);
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
  }

  // 6. Update job correction context
  updateJobCorrectionContext(job.id, correctionText);
  emit("job.updated", { jobId: job.id });

  // 7. Create corrective run
  const correctiveRun = createRun({
    jobId: job.id,
    triggerSource: "corrective",
    parentRunId: failedRunId,
    correctionContext: correctionText,
  });

  console.error(`[self-correction] created corrective run ${correctiveRun.id} for failed run ${failedRunId}`);

  emit("run.created", { runId: correctiveRun.id, jobId: job.id });
  emit("run.statusChanged", {
    runId: correctiveRun.id,
    status: "queued",
    previousStatus: "queued",
  });

  // 8. Enqueue at priority 2 (corrective)
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

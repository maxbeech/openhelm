/**
 * Failure Triage — promotes unfixable failures to permanent_failure
 * and creates inbox items for user attention.
 */

import { getRun } from "../db/queries/runs.js";
import { updateRun } from "../db/queries/runs.js";
import { getJob } from "../db/queries/jobs.js";
import { createInboxItem } from "../db/queries/inbox-items.js";
import { emit } from "../ipc/emitter.js";

export function triagePermanentFailure(
  runId: string,
  reason: string,
): void {
  const run = getRun(runId);
  if (!run) {
    console.error(`[failure-triage] run not found: ${runId}`);
    return;
  }

  const job = getJob(run.jobId);
  if (!job) {
    console.error(`[failure-triage] job not found for run: ${runId}`);
    return;
  }

  // Promote failed → permanent_failure
  updateRun({ id: runId, status: "permanent_failure" });
  emit("run.statusChanged", {
    runId,
    status: "permanent_failure",
    previousStatus: "failed",
  });

  // Create inbox item
  const item = createInboxItem({
    runId,
    jobId: job.id,
    projectId: job.projectId,
    type: "permanent_failure",
    title: `"${job.name}" failed permanently`,
    message: reason || "This failure was classified as unfixable by the AI analyzer.",
  });

  console.error(`[failure-triage] run ${runId} promoted to permanent_failure, inbox item ${item.id}`);
  emit("inbox.created", item);
}

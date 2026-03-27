/**
 * Failure Triage — promotes unfixable failures to permanent_failure
 * and creates dashboard items for user attention.
 */

import { getRun } from "../db/queries/runs.js";
import { updateRun } from "../db/queries/runs.js";
import { getJob } from "../db/queries/jobs.js";
import { createDashboardItem } from "../db/queries/dashboard-items.js";
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

  // Create dashboard item
  const item = createDashboardItem({
    runId,
    jobId: job.id,
    projectId: job.projectId,
    type: "permanent_failure",
    title: `"${job.name}" failed permanently`,
    message: reason || "This failure was classified as unfixable by the AI analyzer.",
  });

  console.error(`[failure-triage] run ${runId} promoted to permanent_failure, dashboard item ${item.id}`);
  emit("dashboard.created", item);
}

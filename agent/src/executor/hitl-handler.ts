/**
 * Human-in-the-Loop Handler — kills hung Claude Code processes
 * that requested interactive input, and creates inbox items.
 */

import { getRun } from "../db/queries/runs.js";
import { getJob } from "../db/queries/jobs.js";
import { createRunLog } from "../db/queries/run-logs.js";
import { createInboxItem } from "../db/queries/inbox-items.js";
import { emit } from "../ipc/emitter.js";

export function handleInteractiveDetected(
  runId: string,
  reason: string,
  abortController: AbortController,
): void {
  // Kill the Claude Code process
  abortController.abort();
  console.error(`[hitl] killed run ${runId}: silence timeout`);

  const run = getRun(runId);
  if (!run) {
    console.error(`[hitl] run not found: ${runId}`);
    return;
  }

  const job = getJob(run.jobId);
  if (!job) {
    console.error(`[hitl] job not found for run: ${runId}`);
    return;
  }

  // Log the reason
  createRunLog({
    runId,
    stream: "stderr",
    text: `Run killed: no output for extended period (silence timeout). Reason: ${reason}`,
  });

  // Create inbox item
  const item = createInboxItem({
    runId,
    jobId: job.id,
    projectId: job.projectId,
    type: "human_in_loop",
    title: `"${job.name}" needs your input`,
    message: reason,
  });

  console.error(`[hitl] inbox item ${item.id} created for run ${runId}`);
  emit("inbox.created", item);
}

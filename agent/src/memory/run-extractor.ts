/**
 * Post-run memory extraction — analyzes run summary + logs
 * to extract useful memories. Fire-and-forget from executor.
 */

import { getRun } from "../db/queries/runs.js";
import { getJob } from "../db/queries/jobs.js";
import { collectRunLogs, truncateLogsForAnalysis } from "../planner/summarize.js";
import { extractMemories } from "./extractor.js";
import type { Job } from "@openorchestra/shared";

/**
 * Extract memories from a completed run.
 * Called fire-and-forget from executor.onRunCompleted().
 */
export async function extractMemoriesFromRun(
  runId: string,
  job: Job,
): Promise<void> {
  console.error(`[run-extractor] starting extraction for run ${runId} (job: ${job.name})`);

  const run = getRun(runId);
  if (!run) {
    console.error(`[run-extractor] run ${runId} not found, skipping`);
    return;
  }

  const fullLogs = collectRunLogs(runId);
  const truncated = truncateLogsForAnalysis(fullLogs);

  const parts: string[] = [];
  // Context header
  parts.push(`Job: "${job.name}"`);
  if (job.description) parts.push(`Description: ${job.description}`);
  parts.push(`Run status: ${run.status}`);
  // Summary first (most distilled, highest-value content)
  if (run.summary) parts.push(`\n## Run Summary\n${run.summary}`);
  // Correction note carries lessons from past failures
  if (job.correctionNote) parts.push(`\n## Correction Note (from prior failures)\n${job.correctionNote}`);
  // Logs last as supporting detail
  if (truncated.trim()) parts.push(`\n## Run Output\n${truncated}`);

  const content = parts.join("\n");
  if (content.length < 50) {
    console.error(`[run-extractor] content too short (${content.length} chars), skipping`);
    return;
  }

  console.error(`[run-extractor] extracting from ${content.length} chars of content`);
  const memories = await extractMemories({
    projectId: job.projectId,
    goalId: job.goalId ?? undefined,
    jobId: job.id,
    sourceType: "run",
    sourceId: runId,
    content,
  });
  console.error(`[run-extractor] extracted ${memories.length} memories from run ${runId}`);
}

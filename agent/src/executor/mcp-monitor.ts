/**
 * MCP Monitor — reactive detection of MCP server failures from run stderr.
 *
 * Creates informational dashboard alerts when MCP connection errors are
 * detected. Does NOT pause the scheduler — MCP issues are often transient
 * or per-job, so self-correction is still allowed to proceed.
 */

import { eq, and } from "drizzle-orm";
import { getDb } from "../db/init.js";
import { dashboardItems } from "../db/schema.js";
import { createDashboardItem } from "../db/queries/dashboard-items.js";
import { getJob } from "../db/queries/jobs.js";
import { emit } from "../ipc/emitter.js";

/**
 * MCP error patterns — matches common MCP server connection failures.
 * These appear in Claude Code stderr when an MCP server is unreachable.
 */
const MCP_ERROR_PATTERN =
  /mcp.*connection\s*(refused|reset|closed)|mcp.*server.*not\s*running|failed\s*to\s*connect.*mcp|mcp.*timed?\s*out|mcp.*unavailable|mcp.*error.*spawn|could\s*not\s*(start|connect\s*to)\s*mcp/i;

/** Test whether stderr output indicates an MCP server failure. */
export function isMcpError(stderr: string): boolean {
  return MCP_ERROR_PATTERN.test(stderr);
}

/**
 * MCP tool-missing pattern — matches when Claude reports a tool is unavailable.
 * This appears in stdout (assistant response text), not stderr, when an MCP
 * server was configured but failed to start or timed out during initialization.
 */
const MCP_TOOL_MISSING_PATTERN =
  /no such tool available:\s*mcp__/i;

/** Test whether text indicates an MCP tool was missing (server failed to start). */
export function isMcpToolMissing(text: string): boolean {
  return MCP_TOOL_MISSING_PATTERN.test(text);
}

/**
 * Check if there is already an open mcp_unavailable dashboard item for a job.
 */
function hasOpenMcpAlert(jobId: string): boolean {
  const db = getDb();
  const row = db
    .select({ id: dashboardItems.id })
    .from(dashboardItems)
    .where(
      and(
        eq(dashboardItems.jobId, jobId),
        eq(dashboardItems.type, "mcp_unavailable"),
        eq(dashboardItems.status, "open"),
      ),
    )
    .get();
  return !!row;
}

/**
 * Handle an MCP server failure detected from a run's stderr.
 * Creates a dashboard alert if one doesn't already exist for this job.
 */
export function handleMcpFailure(
  runId: string,
  jobId: string,
  projectId: string,
  errorDetail: string,
): void {
  console.error(`[mcp-monitor] MCP failure detected for run ${runId}`);

  // Deduplicate — skip if an open alert already exists for this job
  if (hasOpenMcpAlert(jobId)) {
    console.error(`[mcp-monitor] open alert already exists for job ${jobId}, skipping`);
    return;
  }

  const job = getJob(jobId);
  const jobName = job?.name ?? "Unknown job";

  const item = createDashboardItem({
    runId,
    jobId,
    projectId,
    type: "mcp_unavailable",
    title: `MCP server unavailable for "${jobName}"`,
    message:
      errorDetail.length > 300
        ? errorDetail.slice(0, 299) + "…"
        : errorDetail || "An MCP server failed to connect during this run.",
  });

  emit("dashboard.created", item);
}

/**
 * Autopilot Post-Run Handler — processes investigation job results.
 *
 * After an autopilot investigation run completes, this handler:
 * - In approval_required mode: creates dashboard items with findings
 * - In full_auto mode: can take corrective actions
 */

import { getJob } from "../db/queries/jobs.js";
import { createDashboardItem } from "../db/queries/dashboard-items.js";
import { getAutopilotMode } from "./index.js";
import type { Run, DashboardItemType } from "@openhelm/shared";

const INVESTIGATION_CATEGORY = "captain_investigation"; // stored in DB — not renamed

/**
 * Check if a completed run is an autopilot investigation and process it.
 * Called from the executor's onRunCompleted handler.
 * Returns true if the run was handled (caller should not process further).
 */
export function handleAutopilotRunCompleted(run: Run): boolean {
  const job = getJob(run.jobId);
  if (!job || job.systemCategory !== INVESTIGATION_CATEGORY) {
    return false;
  }

  const mode = getAutopilotMode();

  if (run.status === "succeeded" && run.summary) {
    createDashboardItem({
      runId: run.id,
      jobId: run.jobId,
      projectId: job.projectId,
      type: "captain_insight" as DashboardItemType, // stored in DB — not renamed
      title: `Autopilot: ${job.name.replace("Investigate: ", "")}`,
      message: run.summary,
    });
  } else if (run.status === "failed" || run.status === "permanent_failure") {
    // Investigation itself failed — log but don't create dashboard noise
    console.error(
      `[autopilot] investigation run ${run.id} failed: ${run.summary ?? "no summary"}`,
    );
  }

  // In full_auto mode, we could take additional corrective actions here
  // based on parsing the run summary. For now, dashboard items suffice
  // as the investigation job itself can take actions via MCP tools.
  if (mode === "full_auto" && run.status === "succeeded") {
    // Future: parse structured output and execute automated fixes
    // For v1, the investigation job handles corrections via MCP tools
  }

  return true;
}

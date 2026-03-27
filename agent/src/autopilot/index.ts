/**
 * Autopilot Orchestrator — manages the lifecycle of system jobs.
 *
 * Two layers of autonomy, both gated by the autopilot_mode setting:
 * - Tactical: per-run self-correction (handled in executor/self-correction.ts)
 * - Strategic: system-generated monitoring/review jobs (handled here)
 *
 * Modes:
 * - full_auto: system jobs created and run without approval
 * - approval_required: system jobs proposed via dashboard for user review
 * - off: no system jobs, no self-correction
 */

import { getSetting } from "../db/queries/settings.js";
import { createJob } from "../db/queries/jobs.js";
import { createProposal } from "../db/queries/autopilot-proposals.js";
import { generateSystemJobs } from "../planner/system-jobs.js";
import { emit } from "../ipc/emitter.js";
import type { AutopilotMode } from "@openhelm/shared";

/** Get the current autopilot mode (defaults to full_auto if not set) */
export function getAutopilotMode(): AutopilotMode {
  const setting = getSetting("autopilot_mode");
  if (!setting?.value) return "full_auto";
  return setting.value as AutopilotMode;
}

/**
 * Generate and handle system jobs for a goal.
 * Called after a user plan is committed (commitPlan).
 * Non-blocking — errors are logged, not thrown.
 */
export async function generateAndHandleSystemJobs(
  goalId: string,
  projectId: string,
): Promise<void> {
  const mode = getAutopilotMode();
  if (mode === "off") return;

  try {
    const systemJobs = await generateSystemJobs(goalId, projectId);
    if (systemJobs.length === 0) {
      console.error("[autopilot] no system jobs generated for goal", goalId);
      return;
    }

    if (mode === "full_auto") {
      // Create jobs immediately
      const jobIds: string[] = [];
      for (const sj of systemJobs) {
        const job = createJob({
          projectId,
          goalId,
          name: sj.name,
          description: sj.description,
          prompt: sj.prompt,
          scheduleType: sj.scheduleType,
          scheduleConfig: sj.scheduleConfig,
          source: "system",
          systemCategory: sj.systemCategory,
          model: "claude-haiku-4-5-20251001",
          modelEffort: "low",
        });
        jobIds.push(job.id);
      }
      console.error(
        `[autopilot] created ${jobIds.length} system jobs for goal ${goalId}`,
      );
      emit("autopilot.systemJobsCreated", { goalId, jobIds });
    } else if (mode === "approval_required") {
      // Create proposal for user review
      const proposal = createProposal({
        goalId,
        projectId,
        plannedJobs: systemJobs,
        reason: `Generated ${systemJobs.length} monitoring job(s) to help track progress and health for this goal.`,
      });
      console.error(
        `[autopilot] created proposal ${proposal.id} for goal ${goalId}`,
      );
      emit("autopilot.proposalCreated", {
        proposalId: proposal.id,
        goalId,
      });
    }
  } catch (err) {
    console.error("[autopilot] failed to generate system jobs:", err);
  }
}

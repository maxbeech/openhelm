import { registerHandler } from "../handler.js";
import { emit } from "../emitter.js";
import {
  getProposal,
  listProposals,
  updateProposalStatus,
} from "../../db/queries/autopilot-proposals.js";
import { createJob, listSystemJobsForGoal } from "../../db/queries/jobs.js";
import { getGoal } from "../../db/queries/goals.js";
import {
  getAutopilotMode,
  generateAndHandleSystemJobs,
  clearBackfillCooldown,
  autopilotScanner,
} from "../../autopilot/index.js";
import { getSetting } from "../../db/queries/settings.js";
import { getBackend } from "../../agent-backend/registry.js";
import type {
  ListAutopilotProposalsParams,
  ApproveAutopilotProposalParams,
  RegenerateSystemJobsParams,
} from "@openhelm/shared";

export function registerAutopilotHandlers() {
  registerHandler("autopilot.getMode", () => {
    return { mode: getAutopilotMode() };
  });

  registerHandler("autopilot.listProposals", (params) => {
    const p = params as ListAutopilotProposalsParams | undefined;
    return listProposals(p);
  });

  registerHandler("autopilot.getProposal", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    return getProposal(id);
  });

  registerHandler("autopilot.approveProposal", (params) => {
    const p = params as ApproveAutopilotProposalParams;
    if (!p?.id) throw new Error("id is required");

    const proposal = getProposal(p.id);
    if (!proposal) throw new Error(`Proposal not found: ${p.id}`);
    if (proposal.status !== "pending") {
      throw new Error(`Proposal already resolved: ${proposal.status}`);
    }

    // Create system jobs from the proposal (use original planned jobs)
    const jobIds: string[] = [];

    for (const sj of proposal.plannedJobs) {
      const job = createJob({
        projectId: proposal.projectId,
        goalId: proposal.goalId,
        name: sj.name,
        description: sj.description,
        prompt: sj.prompt,
        scheduleType: sj.scheduleType,
        scheduleConfig: sj.scheduleConfig,
        source: "system",
        systemCategory: sj.systemCategory,
        model: getBackend().resolveModel("classification"),
        modelEffort: "low",
      });
      jobIds.push(job.id);
    }

    // Mark proposal as approved
    const updated = updateProposalStatus(p.id, "approved");

    emit("autopilot.proposalApproved", {
      proposalId: p.id,
      goalId: proposal.goalId,
      jobIds,
    });

    return { proposal: updated, jobIds };
  });

  registerHandler("autopilot.rejectProposal", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");

    const proposal = getProposal(id);
    if (!proposal) throw new Error(`Proposal not found: ${id}`);
    if (proposal.status !== "pending") {
      throw new Error(`Proposal already resolved: ${proposal.status}`);
    }

    const updated = updateProposalStatus(id, "rejected");
    emit("autopilot.proposalRejected", { proposalId: id, goalId: proposal.goalId });
    return updated;
  });

  registerHandler("autopilot.regenerateSystemJobs", async (params) => {
    const p = params as RegenerateSystemJobsParams;
    if (!p?.goalId) throw new Error("goalId is required");

    const goal = getGoal(p.goalId);
    if (!goal) throw new Error(`Goal not found: ${p.goalId}`);

    clearBackfillCooldown(p.goalId);
    await generateAndHandleSystemJobs(p.goalId, goal.projectId);
    return { success: true };
  });

  registerHandler("autopilot.listSystemJobsForGoal", (params) => {
    const { goalId } = params as { goalId: string };
    if (!goalId) throw new Error("goalId is required");
    return listSystemJobsForGoal(goalId);
  });

  /** Trigger autopilot generation for a goal (called from frontend after goal+jobs creation) */
  registerHandler("autopilot.generateForGoal", async (params) => {
    const { goalId, projectId } = params as { goalId: string; projectId: string };
    if (!goalId || !projectId) throw new Error("goalId and projectId are required");
    clearBackfillCooldown(goalId);
    await generateAndHandleSystemJobs(goalId, projectId);
    return { success: true };
  });

  registerHandler("autopilot.getStatus", () => {
    const intervalSetting = getSetting("autopilot_scan_interval_minutes");
    const intervalMinutes = intervalSetting?.value
      ? parseInt(intervalSetting.value, 10) || 30
      : 30;
    return { intervalMinutes };
  });

  registerHandler("autopilot.forceScan", async () => {
    await autopilotScanner.forceScan();
    return { success: true };
  });
}

import { registerHandler } from "../handler.js";
import {
  getDashboardItem,
  listDashboardItems,
  resolveDashboardItem,
  countOpenDashboardItems,
} from "../../db/queries/dashboard-items.js";
import { createRun } from "../../db/queries/runs.js";
import { getJob, updateJobCorrectionNote } from "../../db/queries/jobs.js";
import { jobQueue } from "../../scheduler/queue.js";
import { executor } from "../../executor/index.js";
import { emit } from "../emitter.js";
import type {
  ListDashboardItemsParams,
  ResolveDashboardItemParams,
} from "@openhelm/shared";

export function registerDashboardHandlers() {
  registerHandler("dashboard.list", (params) => {
    return listDashboardItems(params as ListDashboardItemsParams | undefined);
  });

  registerHandler("dashboard.get", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const item = getDashboardItem(id);
    if (!item) throw new Error(`Dashboard item not found: ${id}`);
    return item;
  });

  registerHandler("dashboard.count", (params) => {
    const p = params as { projectId?: string } | undefined;
    return { count: countOpenDashboardItems(p?.projectId) };
  });

  registerHandler("dashboard.resolve", async (params) => {
    const p = params as ResolveDashboardItemParams;
    if (!p?.id) throw new Error("id is required");
    if (!p?.action) throw new Error("action is required");

    const item = getDashboardItem(p.id);
    if (!item) throw new Error(`Dashboard item not found: ${p.id}`);

    if (p.action === "dismiss") {
      const resolved = resolveDashboardItem(p.id, "dismissed");
      emit("dashboard.resolved", resolved);
      return resolved;
    }

    if (p.action === "try_again") {
      const resolved = resolveDashboardItem(p.id, "resolved");
      emit("dashboard.resolved", resolved);

      // Create a fresh manual run for the same job
      const run = createRun({
        jobId: item.jobId,
        triggerSource: "manual",
      });
      jobQueue.enqueue({
        runId: run.id,
        jobId: item.jobId,
        priority: 0,
        enqueuedAt: Date.now(),
      });
      emit("run.created", { runId: run.id, jobId: item.jobId });
      emit("run.statusChanged", {
        runId: run.id,
        status: "queued",
        jobId: item.jobId,
      });
      executor.processNext();

      return resolved;
    }

    if (p.action === "do_something_different") {
      if (!p.guidance) throw new Error("guidance is required for do_something_different");

      const resolved = resolveDashboardItem(p.id, "resolved");
      emit("dashboard.resolved", resolved);

      // Update job correction context with user guidance
      const job = getJob(item.jobId);
      if (!job) throw new Error(`Job not found: ${item.jobId}`);
      updateJobCorrectionNote(job.id, p.guidance);
      emit("job.updated", { jobId: job.id });

      // Create corrective run with user guidance
      const run = createRun({
        jobId: item.jobId,
        triggerSource: "corrective",
        parentRunId: item.runId,
        correctionNote: p.guidance,
      });
      jobQueue.enqueue({
        runId: run.id,
        jobId: item.jobId,
        priority: 2,
        enqueuedAt: Date.now(),
      });
      emit("run.created", { runId: run.id, jobId: item.jobId });
      emit("run.statusChanged", {
        runId: run.id,
        status: "queued",
        jobId: item.jobId,
      });
      executor.processNext();

      return resolved;
    }

    if (p.action === "re_authenticated") {
      const resolved = resolveDashboardItem(p.id, "resolved");
      emit("dashboard.resolved", resolved);

      // Run health check and resume interrupted runs
      const { attemptAuthResume } = await import("../../executor/auth-monitor.js");
      const resumeResult = await attemptAuthResume((queueItem) => {
        jobQueue.enqueue(queueItem);
        executor.processNext();
      });

      return { ...resolved, resumeResult };
    }

    throw new Error(`Unknown action: ${p.action}`);
  });

  // Dedicated handler for re-authentication (can also be called directly)
  registerHandler("health.reAuthenticated", async () => {
    const { attemptAuthResume } = await import("../../executor/auth-monitor.js");
    return attemptAuthResume((queueItem) => {
      jobQueue.enqueue(queueItem);
      executor.processNext();
    });
  });
}

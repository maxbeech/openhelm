import { registerHandler } from "../handler.js";
import {
  getInboxItem,
  listInboxItems,
  resolveInboxItem,
  countOpenInboxItems,
} from "../../db/queries/inbox-items.js";
import { createRun } from "../../db/queries/runs.js";
import { getJob, updateJobCorrectionNote } from "../../db/queries/jobs.js";
import { jobQueue } from "../../scheduler/queue.js";
import { executor } from "../../executor/index.js";
import { emit } from "../emitter.js";
import type {
  ListInboxItemsParams,
  ResolveInboxItemParams,
} from "@openorchestra/shared";

export function registerInboxHandlers() {
  registerHandler("inbox.list", (params) => {
    return listInboxItems(params as ListInboxItemsParams | undefined);
  });

  registerHandler("inbox.get", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const item = getInboxItem(id);
    if (!item) throw new Error(`Inbox item not found: ${id}`);
    return item;
  });

  registerHandler("inbox.count", (params) => {
    const p = params as { projectId?: string } | undefined;
    return { count: countOpenInboxItems(p?.projectId) };
  });

  registerHandler("inbox.resolve", (params) => {
    const p = params as ResolveInboxItemParams;
    if (!p?.id) throw new Error("id is required");
    if (!p?.action) throw new Error("action is required");

    const item = getInboxItem(p.id);
    if (!item) throw new Error(`Inbox item not found: ${p.id}`);

    if (p.action === "dismiss") {
      const resolved = resolveInboxItem(p.id, "dismissed");
      emit("inbox.resolved", resolved);
      return resolved;
    }

    if (p.action === "try_again") {
      const resolved = resolveInboxItem(p.id, "resolved");
      emit("inbox.resolved", resolved);

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

      const resolved = resolveInboxItem(p.id, "resolved");
      emit("inbox.resolved", resolved);

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

    throw new Error(`Unknown action: ${p.action}`);
  });
}

import { registerHandler } from "../handler.js";
import { emit } from "../emitter.js";
import * as jobQueries from "../../db/queries/jobs.js";
import { pickIcon } from "../../planner/icon-picker.js";
import { extractMemoriesFromJob } from "../../memory/job-extractor.js";
import type {
  CreateJobParams,
  UpdateJobParams,
  ListJobsParams,
} from "@openorchestra/shared";

export function registerJobHandlers() {
  registerHandler("jobs.create", (params) => {
    const p = params as CreateJobParams;
    if (!p?.projectId) throw new Error("projectId is required");
    if (!p?.name) throw new Error("name is required");
    if (!p?.prompt) throw new Error("prompt is required");
    if (!p?.scheduleType) throw new Error("scheduleType is required");
    if (!p?.scheduleConfig) throw new Error("scheduleConfig is required");
    const job = jobQueries.createJob(p);

    // Fire-and-forget: pick an icon in the background
    pickIcon(p.name, p.description).then((icon) => {
      if (icon) {
        jobQueries.updateJob({ id: job.id, icon });
        emit("job.iconUpdated", { id: job.id, icon });
      }
    });

    // Fire-and-forget: extract memories from job prompt
    extractMemoriesFromJob(p.projectId, job.id, p.name, p.prompt, p.goalId, p.description).catch((err) =>
      console.error("[jobs] memory extraction error:", err),
    );

    return job;
  });

  registerHandler("jobs.get", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const job = jobQueries.getJob(id);
    if (!job) throw new Error(`Job not found: ${id}`);
    return job;
  });

  registerHandler("jobs.list", (params) => {
    return jobQueries.listJobs(params as ListJobsParams | undefined);
  });

  registerHandler("jobs.update", (params) => {
    const p = params as UpdateJobParams;
    if (!p?.id) throw new Error("id is required");
    return jobQueries.updateJob(p);
  });

  registerHandler("jobs.archive", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    return jobQueries.archiveJob(id);
  });

  registerHandler("jobs.delete", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    return { deleted: jobQueries.deleteJob(id) };
  });
}

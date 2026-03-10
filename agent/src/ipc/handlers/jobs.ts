import { registerHandler } from "../handler.js";
import * as jobQueries from "../../db/queries/jobs.js";
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
    return jobQueries.createJob(p);
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

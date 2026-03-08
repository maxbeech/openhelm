import { registerHandler } from "../handler.js";
import * as runQueries from "../../db/queries/runs.js";
import * as runLogQueries from "../../db/queries/run-logs.js";
import type {
  CreateRunParams,
  UpdateRunParams,
  ListRunsParams,
  CreateRunLogParams,
  ListRunLogsParams,
} from "@openorchestra/shared";

export function registerRunHandlers() {
  // -- Runs --

  registerHandler("runs.create", (params) => {
    const p = params as CreateRunParams;
    if (!p?.jobId) throw new Error("jobId is required");
    if (!p?.triggerSource) throw new Error("triggerSource is required");
    return runQueries.createRun(p);
  });

  registerHandler("runs.get", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const run = runQueries.getRun(id);
    if (!run) throw new Error(`Run not found: ${id}`);
    return run;
  });

  registerHandler("runs.list", (params) => {
    return runQueries.listRuns(params as ListRunsParams | undefined);
  });

  registerHandler("runs.update", (params) => {
    const p = params as UpdateRunParams;
    if (!p?.id) throw new Error("id is required");
    return runQueries.updateRun(p);
  });

  registerHandler("runs.delete", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    return { deleted: runQueries.deleteRun(id) };
  });

  // -- Run Logs --

  registerHandler("runLogs.create", (params) => {
    const p = params as CreateRunLogParams;
    if (!p?.runId) throw new Error("runId is required");
    if (!p?.stream) throw new Error("stream is required");
    if (p?.text === undefined) throw new Error("text is required");
    return runLogQueries.createRunLog(p);
  });

  registerHandler("runLogs.list", (params) => {
    const p = params as ListRunLogsParams;
    if (!p?.runId) throw new Error("runId is required");
    return runLogQueries.listRunLogs(p);
  });
}

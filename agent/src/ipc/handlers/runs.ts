import { spawnSync } from "child_process";
import { registerHandler } from "../handler.js";
import * as runQueries from "../../db/queries/runs.js";
import * as runLogQueries from "../../db/queries/run-logs.js";
import { getJob } from "../../db/queries/jobs.js";
import { getProject } from "../../db/queries/projects.js";
import { getSetting } from "../../db/queries/settings.js";
import type {
  CreateRunParams,
  UpdateRunParams,
  ListRunsParams,
  CreateRunLogParams,
  ListRunLogsParams,
  GetJobTokenStatsParams,
} from "@openhelm/shared";

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

  registerHandler("runs.clearByJob", (params) => {
    const { jobId } = params as { jobId: string };
    if (!jobId) throw new Error("jobId is required");
    return { cleared: runQueries.clearRunsByJob(jobId) };
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

  registerHandler("runs.openInTerminal", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");

    const run = runQueries.getRun(id);
    if (!run) throw new Error(`Run not found: ${id}`);
    if (!run.sessionId) throw new Error("Run has no session ID — it may have been created before session tracking was added, or the run did not complete normally.");

    const job = getJob(run.jobId);
    if (!job) throw new Error(`Job not found: ${run.jobId}`);

    const project = getProject(job.projectId);
    if (!project) throw new Error(`Project not found: ${job.projectId}`);

    const workingDir = job.workingDirectory ?? project.directoryPath;
    const claudePathSetting = getSetting("claude_code_path");
    const claudePath = claudePathSetting?.value ?? "claude";

    openRunInMacTerminal(workingDir, claudePath, run.sessionId);
    return { opened: true };
  });

  registerHandler("runs.getTokenStats", (params) => {
    return runQueries.getJobTokenStats((params ?? {}) as GetJobTokenStatsParams);
  });
}

/**
 * Open a new Terminal window on macOS and run `claude --resume <sessionId>` in
 * the given working directory. Uses osascript (AppleScript) which is available
 * on all macOS versions.
 *
 * Path escaping: paths are wrapped in single quotes; single quotes inside paths
 * are escaped as '\''.
 */
function openRunInMacTerminal(workingDir: string, claudePath: string, sessionId: string): void {
  const sq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const shellCmd = `cd ${sq(workingDir)} && ${sq(claudePath)} --resume ${sessionId}`;
  // Embed shell command in AppleScript string: escape backslashes then double-quotes
  const appleStr = shellCmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = `tell application "Terminal"\nactivate\ndo script "${appleStr}"\nend tell`;
  spawnSync("osascript", ["-e", script]);
}

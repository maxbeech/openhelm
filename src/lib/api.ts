import { agentClient } from "./agent-client";
import type {
  Project,
  Goal,
  Job,
  Run,
  RunLog,
  Setting,
  SettingKey,
  CreateProjectParams,
  UpdateProjectParams,
  CreateGoalParams,
  UpdateGoalParams,
  ListGoalsParams,
  CreateJobParams,
  UpdateJobParams,
  ListJobsParams,
  CreateRunParams,
  UpdateRunParams,
  ListRunsParams,
  CreateRunLogParams,
  ListRunLogsParams,
  SetSettingParams,
  ClaudeCodeDetectionResult,
  DetectClaudeCodeParams,
  VerifyClaudeCodeParams,
  TriggerRunParams,
  CancelRunParams,
  SchedulerStatus,
} from "@openorchestra/shared";

// ─── Projects ───

export function createProject(params: CreateProjectParams): Promise<Project> {
  return agentClient.request<Project>("projects.create", params);
}

export function getProject(id: string): Promise<Project> {
  return agentClient.request<Project>("projects.get", { id });
}

export function listProjects(): Promise<Project[]> {
  return agentClient.request<Project[]>("projects.list");
}

export function updateProject(params: UpdateProjectParams): Promise<Project> {
  return agentClient.request<Project>("projects.update", params);
}

export function deleteProject(id: string): Promise<{ deleted: boolean }> {
  return agentClient.request<{ deleted: boolean }>("projects.delete", { id });
}

// ─── Goals ───

export function createGoal(params: CreateGoalParams): Promise<Goal> {
  return agentClient.request<Goal>("goals.create", params);
}

export function getGoal(id: string): Promise<Goal> {
  return agentClient.request<Goal>("goals.get", { id });
}

export function listGoals(params: ListGoalsParams): Promise<Goal[]> {
  return agentClient.request<Goal[]>("goals.list", params);
}

export function updateGoal(params: UpdateGoalParams): Promise<Goal> {
  return agentClient.request<Goal>("goals.update", params);
}

export function deleteGoal(id: string): Promise<{ deleted: boolean }> {
  return agentClient.request<{ deleted: boolean }>("goals.delete", { id });
}

// ─── Jobs ───

export function createJob(params: CreateJobParams): Promise<Job> {
  return agentClient.request<Job>("jobs.create", params);
}

export function getJob(id: string): Promise<Job> {
  return agentClient.request<Job>("jobs.get", { id });
}

export function listJobs(params?: ListJobsParams): Promise<Job[]> {
  return agentClient.request<Job[]>("jobs.list", params);
}

export function updateJob(params: UpdateJobParams): Promise<Job> {
  return agentClient.request<Job>("jobs.update", params);
}

export function deleteJob(id: string): Promise<{ deleted: boolean }> {
  return agentClient.request<{ deleted: boolean }>("jobs.delete", { id });
}

// ─── Runs ───

export function createRun(params: CreateRunParams): Promise<Run> {
  return agentClient.request<Run>("runs.create", params);
}

export function getRun(id: string): Promise<Run> {
  return agentClient.request<Run>("runs.get", { id });
}

export function listRuns(params?: ListRunsParams): Promise<Run[]> {
  return agentClient.request<Run[]>("runs.list", params);
}

export function updateRun(params: UpdateRunParams): Promise<Run> {
  return agentClient.request<Run>("runs.update", params);
}

export function deleteRun(id: string): Promise<{ deleted: boolean }> {
  return agentClient.request<{ deleted: boolean }>("runs.delete", { id });
}

// ─── Run Logs ───

export function createRunLog(params: CreateRunLogParams): Promise<RunLog> {
  return agentClient.request<RunLog>("runLogs.create", params);
}

export function listRunLogs(params: ListRunLogsParams): Promise<RunLog[]> {
  return agentClient.request<RunLog[]>("runLogs.list", params);
}

// ─── Settings ───

export function getSetting(key: SettingKey): Promise<Setting | null> {
  return agentClient.request<Setting | null>("settings.get", { key });
}

export function listSettings(): Promise<Setting[]> {
  return agentClient.request<Setting[]>("settings.list");
}

export function setSetting(params: SetSettingParams): Promise<Setting> {
  return agentClient.request<Setting>("settings.set", params);
}

export function deleteSetting(
  key: SettingKey,
): Promise<{ deleted: boolean }> {
  return agentClient.request<{ deleted: boolean }>("settings.delete", { key });
}

// ─── Claude Code ───

export function detectClaudeCode(
  params?: DetectClaudeCodeParams,
): Promise<ClaudeCodeDetectionResult> {
  return agentClient.request<ClaudeCodeDetectionResult>(
    "claudeCode.detect",
    params,
  );
}

export function verifyClaudeCode(
  params: VerifyClaudeCodeParams,
): Promise<ClaudeCodeDetectionResult> {
  return agentClient.request<ClaudeCodeDetectionResult>(
    "claudeCode.verify",
    params,
  );
}

export function getClaudeCodeStatus(): Promise<ClaudeCodeDetectionResult> {
  return agentClient.request<ClaudeCodeDetectionResult>(
    "claudeCode.getStatus",
  );
}

// ─── Scheduler & Executor ───

export function triggerRun(params: TriggerRunParams): Promise<Run> {
  return agentClient.request<Run>("runs.trigger", params);
}

export function cancelRun(params: CancelRunParams): Promise<{ cancelled: boolean }> {
  return agentClient.request<{ cancelled: boolean }>("runs.cancel", params);
}

export function getSchedulerStatus(): Promise<SchedulerStatus> {
  return agentClient.request<SchedulerStatus>("scheduler.status");
}

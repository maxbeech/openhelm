// ─── IPC Protocol Types ───

/** IPC request sent from UI to agent via stdin */
export interface IpcRequest {
  id: string;
  method: string;
  params?: unknown;
}

/** Structured error returned by the agent */
export interface IpcError {
  code: number;
  message: string;
}

/** IPC response sent from agent to UI via stdout */
export interface IpcResponse {
  id: string;
  result?: unknown;
  error?: IpcError;
}

/** Unprompted event emitted by the agent */
export interface IpcEvent {
  event: string;
  data: unknown;
}

/** Type guard: checks if a parsed JSON object is an IpcResponse */
export function isIpcResponse(obj: unknown): obj is IpcResponse {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "id" in obj &&
    typeof (obj as IpcResponse).id === "string"
  );
}

/** Type guard: checks if a parsed JSON object is an IpcEvent */
export function isIpcEvent(obj: unknown): obj is IpcEvent {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "event" in obj &&
    typeof (obj as IpcEvent).event === "string" &&
    !("id" in obj)
  );
}

// ─── Entity Types ───

export interface Project {
  id: string;
  name: string;
  description: string | null;
  directoryPath: string;
  createdAt: string;
  updatedAt: string;
}

export type GoalStatus = "active" | "paused" | "archived";

export interface Goal {
  id: string;
  projectId: string;
  description: string;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

export type ScheduleType = "once" | "interval" | "cron";

export interface ScheduleConfigOnce {
  fireAt: string; // ISO 8601 datetime
}

export interface ScheduleConfigInterval {
  minutes: number;
}

export interface ScheduleConfigCron {
  expression: string;
}

export type ScheduleConfig =
  | ScheduleConfigOnce
  | ScheduleConfigInterval
  | ScheduleConfigCron;

export interface Job {
  id: string;
  goalId: string | null;
  projectId: string;
  name: string;
  description: string | null;
  prompt: string;
  scheduleType: ScheduleType;
  scheduleConfig: ScheduleConfig;
  isEnabled: boolean;
  nextFireAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "permanent_failure"
  | "cancelled";

export type TriggerSource = "scheduled" | "manual" | "corrective";

export interface Run {
  id: string;
  jobId: string;
  status: RunStatus;
  triggerSource: TriggerSource;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  summary: string | null;
  createdAt: string;
}

export type LogStream = "stdout" | "stderr";

export interface RunLog {
  id: string;
  runId: string;
  sequence: number;
  stream: LogStream;
  text: string;
  timestamp: string;
}

export type SettingKey =
  | "anthropic_api_key"
  | "claude_code_path"
  | "claude_code_version"
  | "max_concurrent_runs"
  | "default_timeout_minutes"
  | "run_timeout_minutes"
  | "theme";

export interface Setting {
  key: SettingKey;
  value: string;
  updatedAt: string;
}

// ─── IPC Method Params & Results ───

// Projects
export interface CreateProjectParams {
  name: string;
  description?: string;
  directoryPath: string;
}

export interface UpdateProjectParams {
  id: string;
  name?: string;
  description?: string;
  directoryPath?: string;
}

// Goals
export interface CreateGoalParams {
  projectId: string;
  description: string;
}

export interface UpdateGoalParams {
  id: string;
  description?: string;
  status?: GoalStatus;
}

// Jobs
export interface CreateJobParams {
  projectId: string;
  goalId?: string;
  name: string;
  description?: string;
  prompt: string;
  scheduleType: ScheduleType;
  scheduleConfig: ScheduleConfig;
  isEnabled?: boolean;
}

export interface UpdateJobParams {
  id: string;
  name?: string;
  description?: string;
  prompt?: string;
  scheduleType?: ScheduleType;
  scheduleConfig?: ScheduleConfig;
  isEnabled?: boolean;
}

// Runs
export interface CreateRunParams {
  jobId: string;
  triggerSource: TriggerSource;
}

export interface UpdateRunParams {
  id: string;
  status?: RunStatus;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  summary?: string;
}

// RunLogs
export interface CreateRunLogParams {
  runId: string;
  stream: LogStream;
  text: string;
}

// Settings
export interface SetSettingParams {
  key: SettingKey;
  value: string;
}

// List params
export interface ListRunsParams {
  jobId?: string;
  status?: RunStatus;
  limit?: number;
  offset?: number;
}

export interface ListRunLogsParams {
  runId: string;
  afterSequence?: number;
}

export interface ListJobsParams {
  projectId?: string;
  goalId?: string;
  isEnabled?: boolean;
}

export interface ListGoalsParams {
  projectId: string;
  status?: GoalStatus;
}

// ─── Claude Code Integration Types ───

/** Result of auto-detecting the Claude Code CLI */
export interface ClaudeCodeDetectionResult {
  found: boolean;
  path: string | null;
  version: string | null;
  meetsMinVersion: boolean;
  error?: string;
}

/** Params for detecting Claude Code (optionally with a manual path) */
export interface DetectClaudeCodeParams {
  manualPath?: string;
}

/** Params for verifying a specific Claude Code path */
export interface VerifyClaudeCodeParams {
  path: string;
}

/** Configuration for a Claude Code run */
export interface ClaudeCodeRunConfig {
  binaryPath: string;
  workingDirectory: string;
  prompt: string;
  timeoutMs: number;
  permissionMode?: string;
  maxBudgetUsd?: number;
}

/** Result of a Claude Code run */
export interface ClaudeCodeRunResult {
  exitCode: number | null;
  timedOut: boolean;
  killed: boolean;
}

// ─── Scheduler & Executor Types ───

/** Params for manually triggering a job run */
export interface TriggerRunParams {
  jobId: string;
}

/** Params for cancelling a run */
export interface CancelRunParams {
  runId: string;
}

/** Current status of the scheduler and executor */
export interface SchedulerStatus {
  schedulerRunning: boolean;
  tickIntervalMs: number;
  activeRuns: number;
  queuedRuns: number;
  maxConcurrency: number;
}

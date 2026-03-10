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
  name: string;
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
  isArchived: boolean;
  workingDirectory: string | null;
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
  | "claude_code_path"
  | "claude_code_version"
  | "max_concurrent_runs"
  | "default_timeout_minutes"
  | "run_timeout_minutes"
  | "notification_permission_requested"
  | "active_project"
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
  name: string;
  description?: string;
}

export interface UpdateGoalParams {
  id: string;
  name?: string;
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
  workingDirectory?: string;
}

export interface UpdateJobParams {
  id: string;
  name?: string;
  description?: string;
  prompt?: string;
  scheduleType?: ScheduleType;
  scheduleConfig?: ScheduleConfig;
  isEnabled?: boolean;
  isArchived?: boolean;
  workingDirectory?: string | null;
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
  projectId?: string;
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

// ─── Chat Types ───

export type MessageRole = "user" | "assistant" | "system" | "tool_result";
/** Source channel of a conversation. Extend for future 3P integrations (WhatsApp, Slack, etc.) */
export type ChatChannel = "app";

export interface Conversation {
  id: string;
  projectId: string;
  channel: ChatChannel;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatToolCall {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface ChatToolResult {
  callId: string;
  tool: string;
  result: unknown;
  error?: string;
}

export interface PendingAction {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  description: string;
  status: "pending" | "approved" | "rejected";
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  toolCalls: ChatToolCall[] | null;
  toolResults: ChatToolResult[] | null;
  pendingActions: PendingAction[] | null;
  createdAt: string;
}

export interface ChatContext {
  viewingGoalId?: string;
  viewingJobId?: string;
  viewingRunId?: string;
}

export interface SendChatMessageParams {
  projectId: string;
  content: string;
  context?: ChatContext;
}

export interface ApproveChatActionParams {
  messageId: string;
  callId: string;
  projectId: string;
}

export interface RejectChatActionParams {
  messageId: string;
  callId: string;
}

export interface ApproveAllChatActionsParams {
  messageId: string;
  projectId: string;
}

export interface RejectAllChatActionsParams {
  messageId: string;
}

export interface ListChatMessagesParams {
  projectId: string;
  limit?: number;
  beforeId?: string;
}

export interface ClearChatParams {
  projectId: string;
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

// ─── Planner Types ───

/** A single clarifying question with multiple-choice options */
export interface ClarifyingQuestion {
  question: string;
  options: string[];
}

/** Result of assessing whether a goal needs clarification */
export interface AssessmentResult {
  needsClarification: boolean;
  questions: ClarifyingQuestion[];
}

/** A single job in a generated plan */
export interface PlannedJob {
  name: string;
  description: string;
  prompt: string;
  rationale: string;
  scheduleType: ScheduleType;
  scheduleConfig: ScheduleConfig;
}

/** A complete generated plan */
export interface GeneratedPlan {
  jobs: PlannedJob[];
}

/** Result of committing a plan to the database */
export interface CommitPlanResult {
  goalId: string;
  jobIds: string[];
}

/** Params for assessing a goal */
export interface AssessGoalParams {
  projectId: string;
  goalDescription: string;
}

/** Params for generating a plan */
export interface GeneratePlanParams {
  projectId: string;
  goalDescription: string;
  clarificationAnswers?: Record<string, string>;
}

/** Params for committing a plan */
export interface CommitPlanParams {
  projectId: string;
  goalDescription: string;
  jobs: PlannedJob[];
}

/** Combined assess + generate result (plan path) */
export interface AssessAndGenerateResultPlan {
  needsClarification: false;
  plan: GeneratedPlan;
}

/** Combined assess + generate result (clarification path) */
export interface AssessAndGenerateResultClarify {
  needsClarification: true;
  questions: ClarifyingQuestion[];
}

/** Discriminated union for combined assess + generate */
export type AssessAndGenerateResult =
  | AssessAndGenerateResultPlan
  | AssessAndGenerateResultClarify;

/** Params for combined assess + generate */
export interface AssessAndGenerateParams {
  projectId: string;
  goalDescription: string;
}

/** Params for assessing a manual job prompt */
export interface AssessPromptParams {
  projectId: string;
  prompt: string;
}

/** Result of assessing a manual job prompt for clarity */
export interface PromptAssessmentResult {
  needsClarification: boolean;
  questions: ClarifyingQuestion[];
}

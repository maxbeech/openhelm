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
  icon: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ScheduleType = "once" | "interval" | "cron" | "calendar" | "manual";

export interface ScheduleConfigOnce {
  fireAt: string; // ISO 8601 datetime
}

export interface ScheduleConfigInterval {
  amount: number;
  unit: "minutes" | "hours" | "days";
}

export interface ScheduleConfigCron {
  expression: string;
}

export interface ScheduleConfigCalendar {
  frequency: "daily" | "weekly" | "monthly";
  /** Local time as "HH:MM" */
  time: string;
  /** 0=Sun … 6=Sat (weekly only; default 1=Mon) — legacy single-day */
  dayOfWeek?: number;
  /** Multi-day weekly selection (takes precedence over dayOfWeek when set) */
  daysOfWeek?: number[];
  /** 1–31 (monthly only; default 1) */
  dayOfMonth?: number;
}

export interface ScheduleConfigManual {
  // No auto-fire — triggered manually only
}

export type ScheduleConfig =
  | ScheduleConfigOnce
  | ScheduleConfigInterval
  | ScheduleConfigCron
  | ScheduleConfigCalendar
  | ScheduleConfigManual;

export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "dontAsk"
  | "bypassPermissions";

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
  model: string;
  modelEffort: "low" | "medium" | "high";
  permissionMode: PermissionMode;
  icon: string | null;
  correctionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RunStatus =
  | "deferred"
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
  parentRunId: string | null;
  correctionNote: string | null;
  scheduledFor: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  summary: string | null;
  sessionId: string | null;
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

export type NotificationLevel = "never" | "on_finish" | "alerts_only";

export type SettingKey =
  | "claude_code_path"
  | "claude_code_version"
  | "max_concurrent_runs"
  | "default_timeout_minutes"
  | "run_timeout_minutes"
  | "notification_level"
  | "active_project"
  | "theme"
  | "auto_correction_enabled"
  | "max_correction_retries"
  | "analytics_enabled"
  | "wake_schedule_enabled"
  | "newsletter_email"
  | "auto_update_enabled"
  | "usage_type"
  | "employee_count"
  | "user_email"
  | "email_verified"
  | "email_verification_token"
  | "newsletter_opt_in"
  | "license_tier"
  | "stripe_customer_id"
  | "stripe_subscription_id"
  | "stripe_subscription_status"
  | "license_verified_at"
  | "scheduler_paused"
  | "update_pending"
  | "onboarding_complete";

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
  icon?: string;
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
  model?: string;
  modelEffort?: "low" | "medium" | "high";
  permissionMode?: PermissionMode;
}

export interface UpdateJobParams {
  id: string;
  name?: string;
  description?: string;
  prompt?: string;
  goalId?: string | null;
  scheduleType?: ScheduleType;
  scheduleConfig?: ScheduleConfig;
  isEnabled?: boolean;
  isArchived?: boolean;
  workingDirectory?: string | null;
  model?: string;
  modelEffort?: "low" | "medium" | "high";
  permissionMode?: PermissionMode;
  icon?: string;
  correctionNote?: string | null;
}

// Runs
export interface CreateRunParams {
  jobId: string;
  triggerSource: TriggerSource;
  status?: RunStatus;
  scheduledFor?: string;
  parentRunId?: string;
  correctionNote?: string;
}

export interface UpdateRunParams {
  id: string;
  status?: RunStatus;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  summary?: string;
  sessionId?: string;
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
  projectId?: string;
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
  model?: string;
  modelEffort?: "low" | "medium" | "high";
  permissionMode?: string;
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
  sessionId: string | null;
}

// ─── Scheduler & Executor Types ───

/** Params for manually triggering a job run */
export interface TriggerRunParams {
  jobId: string;
  /** Optional ISO 8601 datetime; if future, creates a deferred run instead of firing immediately */
  fireAt?: string;
}

/** Params for cancelling a run */
export interface CancelRunParams {
  runId: string;
}

/** Params for clearing all run history for a job */
export interface ClearRunsByJobParams {
  jobId: string;
}

/** Current status of the scheduler and executor */
export interface SchedulerStatus {
  schedulerRunning: boolean;
  paused: boolean;
  tickIntervalMs: number;
  activeRuns: number;
  queuedRuns: number;
  maxConcurrency: number;
}

/** Result of executor.prepareForUpdate — tells the frontend how many runs are active */
export interface PrepareForUpdateResult {
  activeRuns: number;
  queuedRuns: number;
  schedulerPaused: boolean;
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

// ─── Inbox Types ───

export type InboxItemType = "permanent_failure" | "human_in_loop";
export type InboxItemStatus = "open" | "resolved" | "dismissed";

export interface InboxItem {
  id: string;
  runId: string;
  jobId: string;
  projectId: string;
  type: InboxItemType;
  status: InboxItemStatus;
  title: string;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface CreateInboxItemParams {
  runId: string;
  jobId: string;
  projectId: string;
  type: InboxItemType;
  title: string;
  message: string;
}

export interface ListInboxItemsParams {
  projectId?: string;
  status?: InboxItemStatus;
}

export type InboxResolveAction = "dismiss" | "try_again" | "do_something_different";

export interface ResolveInboxItemParams {
  id: string;
  action: InboxResolveAction;
  guidance?: string;
}

// ─── Memory Types ───

export type MemoryType = "semantic" | "episodic" | "procedural" | "source";
export type MemorySourceType = "run" | "goal" | "job" | "chat" | "user" | "system";

export const DEFAULT_MEMORY_TAGS = [
  "goal",
  "data-source",
  "preference",
  "workflow",
  "error-pattern",
  "tool-usage",
  "architecture",
  "convention",
] as const;

export interface Memory {
  id: string;
  projectId: string;
  goalId: string | null;
  jobId: string | null;
  type: MemoryType;
  content: string;
  sourceType: MemorySourceType;
  sourceId: string | null;
  importance: number; // 0-10 (stored as integer, display as 0.0-1.0)
  accessCount: number;
  lastAccessedAt: string | null;
  tags: string[];
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMemoryParams {
  projectId: string;
  goalId?: string;
  jobId?: string;
  type: MemoryType;
  content: string;
  sourceType: MemorySourceType;
  sourceId?: string;
  importance?: number;
  tags?: string[];
}

export interface UpdateMemoryParams {
  id: string;
  content?: string;
  type?: MemoryType;
  importance?: number;
  tags?: string[];
  isArchived?: boolean;
}

export interface ListMemoriesParams {
  projectId: string;
  type?: MemoryType;
  tag?: string;
  isArchived?: boolean;
  search?: string;
}

export interface MemoryRetrievalContext {
  projectId: string;
  goalId?: string;
  jobId?: string;
  query: string;
  maxResults?: number;
}

// ─── Data Import/Export Types ───

export interface ExportParams {
  includeRunLogs: boolean;
  filePath: string;
}

export interface RecordCounts {
  projects: number;
  goals: number;
  jobs: number;
  runs: number;
  runLogs: number;
  conversations: number;
  messages: number;
  inboxItems: number;
  memories: number;
  runMemories: number;
  settings: number;
}

export interface ExportResult {
  success: boolean;
  filePath: string;
  recordCounts: RecordCounts;
  fileSizeBytes: number;
}

export interface ImportParams {
  filePath: string;
}

export interface ImportPreviewResult {
  valid: boolean;
  error?: string;
  version?: number;
  exportedAt?: string;
  appVersion?: string;
  includesRunLogs?: boolean;
  recordCounts?: RecordCounts;
  fileSizeBytes: number;
}

export interface ImportExecuteParams {
  filePath: string;
}

export interface InvalidProjectPath {
  projectId: string;
  projectName: string;
  directoryPath: string;
}

export interface SkippedSetting {
  key: string;
  reason: string;
}

export interface ImportResult {
  success: boolean;
  recordCounts: RecordCounts;
  invalidPaths: InvalidProjectPath[];
  skippedSettings: SkippedSetting[];
}

export interface ExportStatsResult {
  totalRecords: number;
  runLogCount: number;
  estimatedSizeWithLogs: number;
  estimatedSizeWithoutLogs: number;
}

export interface FixProjectPathParams {
  id: string;
  directoryPath: string;
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

// ─── License & Payment Types ───

export type UsageType = "personal" | "education" | "business";
export type EmployeeCount = "1-3" | "4-10" | "11-50" | "51-200" | "200+";
export type LicenseTier = "community" | "business";

export interface LicenseStatus {
  tier: LicenseTier;
  usageType: UsageType | null;
  employeeCount: EmployeeCount | null;
  email: string | null;
  emailVerified: boolean;
  stripeSubscriptionStatus: string | null;
  trialEndsAt: string | null;
  isValid: boolean;
}

export interface RequestEmailVerificationParams {
  email: string;
  usageType?: UsageType;
  newsletterOptIn: boolean;
}

export interface EmailVerificationResult {
  sent: boolean;
  token: string;
  error?: string;
}

export interface CheckEmailVerificationParams {
  token: string;
}

export interface EmailVerificationStatus {
  verified: boolean;
}

export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
}

export interface PollCheckoutSessionParams {
  sessionId: string;
}

export interface PollCheckoutSessionResult {
  complete: boolean;
  customerId?: string;
  subscriptionId?: string;
}

export interface CustomerPortalResult {
  url: string;
}

/** A single price entry from Stripe */
export interface StripePriceEntry {
  currency: string; // lowercase ISO 4217 e.g. "usd", "gbp", "eur"
  unitAmount: number; // amount in minor units (cents/pence)
  interval: "month" | "year";
}

/** Result from the pricing endpoint */
export interface PricingResult {
  prices: StripePriceEntry[];
}

export interface CreateCheckoutSessionWithCurrencyParams {
  email: string;
  employeeCount: EmployeeCount;
  currency?: string; // preferred currency ISO code
}

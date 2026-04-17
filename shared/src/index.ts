export { evaluateFormula } from "./formula-evaluator.js";
export { computeRollup } from "./rollup-evaluator.js";

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
  parentId: string | null;
  name: string;
  description: string;
  status: GoalStatus;
  icon: string | null;
  isSystem: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Goal with resolved children for tree rendering */
export interface GoalTreeNode extends Goal {
  children: GoalTreeNode[];
  depth: number;
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

export type JobSource = "user" | "system";
export type AutopilotMode = "full_auto" | "approval_required" | "off";

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
  silenceTimeoutMinutes: number | null;
  source: JobSource;
  systemCategory: string | null;
  sortOrder: number;
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
  inputTokens: number | null;
  outputTokens: number | null;
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
  | "claude_daily_budget"
  | "claude_weekly_budget"
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
  | "onboarding_complete"
  | "global_prompt"
  | "focus_guard_enabled"
  | "autopilot_mode"
  | "sidebar_project_group_order"
  | "auth_interrupted_runs"
  | "autopilot_backfill_failures"
  | "stripe_trial_end"
  | "terminal_access_granted"
  | "show_system_items"
  | "autopilot_scan_interval_minutes"
  | "autopilot_last_snapshot"
  | "autopilot_investigation_cooldowns"
  | "inbox_backfill_complete"
  | "inbox_backfill_v2"
  | "inbox_backfill_v3"
  | "inbox_backfill_v4"
  | "inbox_backfill_v5"
  | "low_token_mode"
  | "claude_weekly_reset_dow"
  | "claude_weekly_reset_hour"
  // LLM provider settings (Goose backend)
  | "goose_provider"
  | "goose_api_key"
  | "goose_model_planning"
  | "goose_model_execution"
  | "goose_model_classification"
  | "goose_model_chat"
  // LLM provider settings (Claude Code backend)
  | "claude_model_planning"
  | "claude_model_classification"
  // CLI error monitor circuit breaker (consecutive transient error tracking)
  | "cli_error_consecutive_count"
  | "cli_error_first_at"
  // Voice settings
  | "voice_enabled"
  | "voice_tts_engine"
  | "voice_interaction_mode"
  | "voice_selected_voice";

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
  /** Cloud mode: git repository URL cloned into E2B sandbox at run start. */
  gitUrl?: string;
}

export interface UpdateProjectParams {
  id: string;
  name?: string;
  description?: string;
  directoryPath?: string;
  /** Cloud mode: git repository URL. */
  gitUrl?: string;
}

// Goals
export interface CreateGoalParams {
  projectId: string;
  name: string;
  description?: string;
  parentId?: string;
  isSystem?: boolean;
  icon?: string;
}

export interface UpdateGoalParams {
  id: string;
  name?: string;
  description?: string;
  status?: GoalStatus;
  icon?: string;
  parentId?: string | null;
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
  silenceTimeoutMinutes?: number | null;
  source?: JobSource;
  systemCategory?: string;
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
  silenceTimeoutMinutes?: number | null;
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
  inputTokens?: number;
  outputTokens?: number;
}

// ─── Claude Code Usage Tracking ───────────────────────────────────────────────

/** One row per UTC day in claude_usage_snapshots */
export interface ClaudeUsageSnapshot {
  id: string;
  date: string;         // YYYY-MM-DD
  recordedAt: string;   // ISO timestamp
  totalInputTokens: number;
  totalOutputTokens: number;
  sonnetInputTokens: number;
  sonnetOutputTokens: number;
  openHelmInputTokens: number;
  openHelmOutputTokens: number;
}

/** Token totals for a period (today / this week / etc.) */
export interface UsagePeriodStat {
  totalTokens: number;      // all models: input + output
  sonnetTokens: number;     // Sonnet only: input + output
  openHelmTokens: number;   // OpenHelm-initiated portion
}

/** One data point in the 30-day trend chart */
export interface UsageDayPoint {
  date: string;          // YYYY-MM-DD
  totalTokens: number;
  openHelmTokens: number;
}

/** Full summary returned by usage.getSummary */
export interface UsageSummary {
  today: UsagePeriodStat;
  todayPrev: UsagePeriodStat;   // same weekday last week
  week: UsagePeriodStat;        // Mon through today (UTC)
  weekPrev: UsagePeriodStat;    // same weekday range last week
  series: UsageDayPoint[];      // last 30 days, ascending
  dailyBudget: number | null;   // user-configured token limit
  weeklyBudget: number | null;
  /** Whether total usage came from JSONL parsing or only from OpenHelm runs */
  dataSource: "jsonl" | "openhelm_only";
}

/** Per-job token usage aggregation returned by getJobTokenStats */
export interface JobTokenStat {
  jobId: string;
  jobName: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  runCount: number;
}

export interface GetJobTokenStatsParams {
  projectId?: string;
  jobIds?: string[];
  from?: string; // ISO datetime (inclusive)
  to?: string;   // ISO datetime (exclusive)
}

/** Per-tool invocation & approximate token usage aggregation */
export interface RunToolStat {
  toolName: string;
  invocations: number;
  approxOutputTokens: number;
}

export interface GetRunToolStatsParams {
  projectId?: string;
  jobIds?: string[];
  from?: string; // ISO datetime (inclusive)
  to?: string;   // ISO datetime (exclusive)
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

export interface SetLowTokenModeParams {
  enabled: boolean;
}

export interface SetLowTokenModeResult {
  enabled: boolean;
  /** ISO timestamp of next auto-reset, if weekly reset is configured */
  nextResetAt: string | null;
}

// List params
export interface ListRunsParams {
  projectId?: string;
  jobId?: string;
  status?: RunStatus;
  since?: string; // ISO timestamp — only return runs created at or after this time
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

/** Snapshot of a goal subtree for undo-delete */
export interface GoalDeleteSnapshot {
  goals: Goal[];
  jobIds: string[];
}

/** Sort mode for sidebar ordering */
export type SortMode =
  | "custom"
  | "alpha_asc"
  | "alpha_desc"
  | "created_asc"
  | "created_desc"
  | "updated_asc"
  | "updated_desc"
  | "tokens_asc"
  | "tokens_desc";

export interface ReorderGoalParams {
  id: string;
  sortOrder: number;
}

export interface ReorderJobParams {
  id: string;
  sortOrder: number;
}

export interface BulkReorderParams {
  /** Array of { id, sortOrder } pairs */
  items: { id: string; sortOrder: number }[];
}

// ─── Chat Types ───

export type MessageRole = "user" | "assistant" | "system" | "tool_result";
/** Source channel of a conversation. Extend for future 3P integrations (WhatsApp, Slack, etc.) */
export type ChatChannel = "app" | "inbox";

export interface Conversation {
  id: string;
  /** NULL = "All Projects" thread; non-null = project-specific thread */
  projectId: string | null;
  channel: ChatChannel;
  title: string | null;
  sortOrder: number;
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
  /** NULL = "All Projects" thread */
  projectId: string | null;
  /** Target a specific conversation thread. Falls back to default if omitted. */
  conversationId?: string;
  content: string;
  context?: ChatContext;
  model?: string;
  modelEffort?: "low" | "medium" | "high";
  permissionMode?: string;
  /** Active demo slug — only set when the sender is inside /demo/:slug. */
  demoSlug?: string;
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
  /** NULL = "All Projects" thread */
  projectId: string | null;
  /** Target a specific conversation thread. Falls back to default if omitted. */
  conversationId?: string;
  limit?: number;
  beforeId?: string;
}

export interface CancelChatMessageParams {
  /** NULL = "All Projects" thread */
  projectId: string | null;
  /** Target a specific conversation thread. */
  conversationId?: string;
}

export interface ClearChatParams {
  /** NULL = "All Projects" thread */
  projectId: string | null;
  /** Target a specific conversation thread. Falls back to default if omitted. */
  conversationId?: string;
}

// ─── Conversation Thread CRUD Types ───

export interface ListConversationsParams {
  projectId: string | null;
}

export interface CreateConversationParams {
  projectId: string | null;
  title?: string;
}

export interface RenameConversationParams {
  conversationId: string;
  title: string;
}

export interface DeleteConversationParams {
  conversationId: string;
}

export interface ReorderConversationsParams {
  /** Ordered list of conversation IDs — index becomes new sortOrder */
  conversationIds: string[];
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
  inputTokens: number | null;
  outputTokens: number | null;
  /** API rate-limit utilization (0.0–1.0) from the last rate_limit_event, or null if none received */
  rateLimitUtilization: number | null;
  /** Per-tool invocation counts and approximate output token attribution */
  toolStats?: RunToolStat[];
  /**
   * True if the run ended via the interactive detector's natural-completion
   * path — the agent emitted a completion signal ("Task Complete", "## Summary")
   * and fell silent within the tail window. The executor should treat this
   * as a clean success, NOT a silence-timeout failure. Round 10 (2026-04-12).
   */
  naturalCompletion?: boolean;
}

// ─── Scheduler & Executor Types ───

/** Params for manually triggering a job run */
export interface TriggerRunParams {
  jobId: string;
  /** Optional ISO 8601 datetime; if future, creates a deferred run instead of firing immediately */
  fireAt?: string;
  /** Optional parent run ID; when set, creates a corrective run that resumes the parent's session */
  parentRunId?: string;
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
  lowTokenMode: boolean;
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

/** A system job planned by the autopilot system */
export interface PlannedSystemJob extends PlannedJob {
  systemCategory: string;
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

// ─── Autopilot Types ───

export type AutopilotProposalStatus = "pending" | "approved" | "rejected" | "expired";

export interface AutopilotProposal {
  id: string;
  goalId: string;
  projectId: string;
  status: AutopilotProposalStatus;
  plannedJobs: PlannedSystemJob[];
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ListAutopilotProposalsParams {
  projectId?: string;
  status?: AutopilotProposalStatus;
}

export interface ApproveAutopilotProposalParams {
  id: string;
  /** Optional per-job modifications before approval */
  modifications?: Partial<PlannedSystemJob>[];
}

export interface RegenerateSystemJobsParams {
  goalId: string;
}

// ─── Dashboard Types ───

export type DashboardItemType = "permanent_failure" | "human_in_loop" | "autopilot_limit" | "captcha_intervention" | "auth_required" | "mcp_unavailable" | "captain_insight";
export type DashboardItemStatus = "open" | "resolved" | "dismissed";

export interface DashboardItem {
  id: string;
  runId: string | null;
  jobId: string;
  projectId: string;
  type: DashboardItemType;
  status: DashboardItemStatus;
  title: string;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface CreateDashboardItemParams {
  runId: string | null;
  jobId: string;
  projectId: string;
  type: DashboardItemType;
  title: string;
  message: string;
}

export interface ListDashboardItemsParams {
  projectId?: string;
  status?: DashboardItemStatus;
}

export type DashboardResolveAction = "dismiss" | "try_again" | "do_something_different" | "re_authenticated";

export interface ResolveDashboardItemParams {
  id: string;
  action: DashboardResolveAction;
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

// ─── Connection Types ───

/** All supported connection types */
export type ConnectionType = "folder" | "mcp" | "cli" | "browser" | "token" | "plain_text";
export type ConnectionScope = "global" | "project" | "goal" | "job";
export type ConnectionInstallStatus = "not_applicable" | "pending" | "installing" | "installed" | "failed";
export type ConnectionAuthStatus = "not_applicable" | "unauthenticated" | "authenticated" | "expired" | "revoked";

/** A single entry in the connection_scope_bindings many-to-many table */
export interface ConnectionScopeBinding {
  scopeType: "project" | "goal" | "job";
  scopeId: string;
}

// Per-type config shapes (stored as JSON in connections.config)
export interface FolderConfig {
  path: string;
  isPrimary: boolean;
  projectId: string;
}

export interface McpConfig {
  mcpServerId: string;
  version?: string;
  transport: "stdio" | "http" | "sse";
  installCommand: string[];
  serverUrl?: string;
  oauthConfig?: {
    authorizationUrl: string;
    tokenUrl: string;
    scopes: string[];
    clientId: string;
  };
}

export interface CliConfig {
  cliId: string;
  packageManager: "brew" | "apt" | "npm" | "pipx" | "curl" | "preinstalled";
  installCommand: string[];
  authFilePaths: string[];
  authCommand?: string[];
}

export interface BrowserConfig {
  loginUrl?: string;
  browserProfileStorageKey?: string;
  verifiedAt?: string;
}

export type ConnectionConfig = FolderConfig | McpConfig | CliConfig | BrowserConfig | Record<string, never>;

export interface Connection {
  id: string;
  name: string;
  type: ConnectionType;
  /** Auto-generated env var name. Empty for folder/mcp/cli types. */
  envVarName: string;
  allowPromptInjection: boolean;
  allowBrowserInjection: boolean;
  browserProfileName: string | null;
  installStatus: ConnectionInstallStatus;
  installError: string | null;
  authStatus: ConnectionAuthStatus;
  oauthTokenExpiresAt: string | null;
  secretRef: string;
  config: ConnectionConfig;
  /** false for primary folder connections */
  isDeletable: boolean;
  scopeType: ConnectionScope;
  scopeId: string | null;
  scopes: ConnectionScopeBinding[];
  isEnabled: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ConnectionValue =
  | { type: "token"; value: string }
  | { type: "username_password"; username: string; password: string }
  | { type: "none" };

/** Connection with its secret value (only returned on explicit reveal) */
export interface ConnectionWithValue extends Connection {
  value: ConnectionValue | null;
}

export interface CreateConnectionParams {
  name: string;
  type: ConnectionType;
  allowPromptInjection?: boolean;
  allowBrowserInjection?: boolean;
  value?: ConnectionValue;
  config?: ConnectionConfig;
  scopeType?: ConnectionScope;
  scopeId?: string;
  scopes?: ConnectionScopeBinding[];
}

export interface UpdateConnectionParams {
  id: string;
  name?: string;
  allowPromptInjection?: boolean;
  allowBrowserInjection?: boolean;
  browserProfileName?: string | null;
  value?: ConnectionValue;
  config?: Partial<ConnectionConfig>;
  scopeType?: ConnectionScope;
  scopeId?: string;
  scopes?: ConnectionScopeBinding[] | null;
  isEnabled?: boolean;
  installStatus?: ConnectionInstallStatus;
  installError?: string | null;
  authStatus?: ConnectionAuthStatus;
  oauthTokenExpiresAt?: string | null;
}

export interface ListConnectionsParams {
  projectId?: string;
  scopeType?: ConnectionScope;
  type?: ConnectionType;
}

export interface ListConnectionsByScopeParams {
  scopeType: "project" | "goal" | "job";
  scopeId: string;
}

// Backward-compat aliases so old imports don't break immediately during migration
/** @deprecated Use Connection instead */
export type Credential = Connection;
/** @deprecated Use ConnectionType instead */
export type CredentialType = ConnectionType;
/** @deprecated Use ConnectionScope instead */
export type CredentialScope = ConnectionScope;
/** @deprecated Use ConnectionScopeBinding instead */
export type CredentialScopeBinding = ConnectionScopeBinding;
/** @deprecated Use ConnectionValue instead */
export type CredentialValue = ConnectionValue;
/** @deprecated Use ConnectionWithValue instead */
export type CredentialWithValue = ConnectionWithValue;
/** @deprecated Use CreateConnectionParams instead */
export type CreateCredentialParams = CreateConnectionParams;
/** @deprecated Use UpdateConnectionParams instead */
export type UpdateCredentialParams = UpdateConnectionParams;
/** @deprecated Use ListConnectionsParams instead */
export type ListCredentialsParams = ListConnectionsParams;
/** @deprecated Use ListConnectionsByScopeParams instead */
export type ListCredentialsByScopeParams = ListConnectionsByScopeParams;

// ─── MCP Registry Types ───

export interface McpRegistrySearchResult {
  id: string;
  name: string;
  namespace: string;
  description: string;
  version?: string;
  verified: boolean;
  transports: string[];
  oauthRequired: boolean;
  installCommand?: string[];
  iconUrl?: string;
}

export interface CliCatalogEntry {
  id: string;
  name: string;
  description: string;
  packageManager: CliConfig["packageManager"];
  installCommand: string[];
  authFilePaths: string[];
  authCommand?: string[];
  iconUrl?: string;
}

// ─── Service catalogue (Plan 14c) ─────────────────────────────────────────────

export type ServiceCategory = "productivity" | "dev" | "comms" | "design" | "data" | "infra" | "ai" | "other";

/** A service the user may want to connect to. Drives the search-first create dialog. */
export interface ServiceCatalogueEntry {
  id: string;              // slug, e.g. "notion"
  name: string;            // display, e.g. "Notion"
  aliases?: string[];      // alt names matched in search
  domain?: string;         // primary website, e.g. "notion.com" (seeds Browser connections)
  iconSlug?: string;       // simple-icons slug; falls back to `id`
  category: ServiceCategory;
  description: string;
  // Capability hints: which connection types should the type-picker surface?
  hasMcp?: boolean;
  mcpServerId?: string;
  mcpInstallCommand?: string[];
  mcpOauthRequired?: boolean;
  hasCli?: boolean;
  cliId?: string;
}

/** A single row in the combined search dropdown. */
export interface ServiceSearchResult {
  /** Catalogue entry if this is a known service; null for MCP-registry-only or custom entries. */
  entry: ServiceCatalogueEntry | null;
  /** MCP registry result, when the service was found (only) in the live MCP registry. */
  mcpRegistry?: McpRegistrySearchResult;
  /** True for the synthetic "use '<query>' as a custom service" trailing row. */
  isCustom: boolean;
  /** Fuzzy match score, 0-1. Used for ranking. */
  score: number;
}

// ─── Browser Profile Setup Types ───

export interface SetupBrowserProfileParams {
  /** Connection ID to set up the profile for. */
  connectionId: string;
  /** Optional URL to navigate to for login (e.g. "https://x.com/login"). */
  loginUrl?: string;
  // @deprecated alias
  credentialId?: string;
}

export interface SetupBrowserProfileResult {
  profileName: string;
  launched: boolean;
  message: string;
  sandboxId?: string;
  streamUrl?: string;
  expiresAt?: number;
}

export interface FinalizeBrowserProfileParams {
  sandboxId: string;
}

export interface FinalizeBrowserProfileResult {
  connectionId: string;
  /** @deprecated Use connectionId */
  credentialId: string;
  status: "likely_logged_in" | "no_cookies_detected";
  storageKey: string;
  verifiedAt: string;
}

export interface CancelBrowserSetupCloudParams {
  sandboxId: string;
}

export type BrowserSetupStatus =
  | "idle"
  | "launching"
  | "browser_open"
  | "verifying"
  | "completed"
  | "no_login_detected"
  | "error";

export interface BrowserSessionVerification {
  connectionId: string;
  /** @deprecated Use connectionId */
  credentialId: string;
  status: "likely_logged_in" | "no_cookies_detected" | "unknown";
  cookiesSizeKb?: number;
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
  dashboardItems: number;
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

// ─── Data Table Types ───

export type DataTableColumnType =
  | "text"
  | "number"
  | "date"
  | "checkbox"
  | "select"
  | "multi_select"
  | "url"
  | "email"
  | "relation"
  | "phone"
  | "files"
  | "rollup"
  | "formula"
  | "created_time"
  | "updated_time";

export interface SelectOption {
  id: string;
  label: string;
  color?: string;
}

/** File reference stored in a files column cell */
export interface FileReference {
  id: string;
  name: string;
  url: string; // local file path or external URL
  size?: number;
  mimeType?: string;
}

/** Rollup aggregation functions */
export type RollupAggregation =
  | "count"
  | "count_values"
  | "count_unique"
  | "sum"
  | "average"
  | "min"
  | "max"
  | "percent_empty"
  | "percent_not_empty"
  | "show_original";

/** Rollup column config shape */
export interface RollupConfig {
  relationColumnId: string; // which relation column in this table to follow
  sourceColumnId: string;   // which column in the target table to aggregate
  aggregation: RollupAggregation;
}

/** Formula column config shape */
export interface FormulaConfig {
  expression: string;
}

export interface DataTableColumn {
  id: string;
  name: string;
  type: DataTableColumnType;
  config: Record<string, unknown>;
  width?: number;
}

export type DataTableCreatedBy = "user" | "ai";

export interface DataTable {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  columns: DataTableColumn[];
  rowCount: number;
  isSystem: boolean;
  createdBy: DataTableCreatedBy;
  createdAt: string;
  updatedAt: string;
}

export interface DataTableRow {
  id: string;
  tableId: string;
  data: Record<string, unknown>;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type DataTableChangeAction = "insert" | "update" | "delete" | "schema_change";
export type DataTableChangeActor = "user" | "ai" | "system";

export interface DataTableChange {
  id: string;
  tableId: string;
  rowId: string | null;
  action: DataTableChangeAction;
  actor: DataTableChangeActor;
  runId: string | null;
  diff: Record<string, unknown>;
  createdAt: string;
}

export interface CreateDataTableParams {
  projectId: string;
  name: string;
  description?: string;
  columns: DataTableColumn[];
  isSystem?: boolean;
  createdBy?: DataTableCreatedBy;
}

export interface UpdateDataTableParams {
  id: string;
  name?: string;
  description?: string;
}

export interface ListDataTablesParams {
  projectId?: string;
}

export interface InsertDataTableRowsParams {
  tableId: string;
  rows: Record<string, unknown>[];
  actor?: DataTableChangeActor;
  runId?: string;
}

export interface UpdateDataTableRowParams {
  id: string;
  data: Record<string, unknown>;
  actor?: DataTableChangeActor;
  runId?: string;
}

export interface DeleteDataTableRowsParams {
  rowIds: string[];
  actor?: DataTableChangeActor;
  runId?: string;
}

export interface ListDataTableRowsParams {
  tableId: string;
  limit?: number;
  offset?: number;
}

export interface AddDataTableColumnParams {
  tableId: string;
  column: DataTableColumn;
  actor?: DataTableChangeActor;
  runId?: string;
}

export interface RenameDataTableColumnParams {
  tableId: string;
  columnId: string;
  newName: string;
  actor?: DataTableChangeActor;
  runId?: string;
}

export interface RemoveDataTableColumnParams {
  tableId: string;
  columnId: string;
  actor?: DataTableChangeActor;
  runId?: string;
}

export interface UpdateDataTableColumnConfigParams {
  tableId: string;
  columnId: string;
  config: Record<string, unknown>;
  actor?: DataTableChangeActor;
  runId?: string;
}

/** Merges a partial patch into a single column (width, name, config, etc.). */
export interface UpdateDataTableColumnParams {
  tableId: string;
  columnId: string;
  patch: Partial<Omit<DataTableColumn, "id">>;
  actor?: DataTableChangeActor;
  runId?: string;
}

/** Reorders the columns array by matching IDs in the given order. */
export interface ReorderDataTableColumnsParams {
  tableId: string;
  columnIds: string[];
  actor?: DataTableChangeActor;
  runId?: string;
}

export interface ListDataTableChangesParams {
  tableId: string;
  limit?: number;
  offset?: number;
}

// ─── Target Types ───

export type TargetDirection = "gte" | "lte" | "eq";
export type TargetAggregation = "latest" | "sum" | "avg" | "max" | "min" | "count";
export type TargetCreatedBy = "user" | "ai";

export interface Target {
  id: string;
  goalId: string | null;
  jobId: string | null;
  projectId: string;
  dataTableId: string;
  columnId: string;
  targetValue: number;
  direction: TargetDirection;
  aggregation: TargetAggregation;
  label: string | null;
  deadline: string | null;
  createdBy: TargetCreatedBy;
  createdAt: string;
  updatedAt: string;
}

export interface TargetEvaluation {
  targetId: string;
  currentValue: number | null;
  targetValue: number;
  direction: TargetDirection;
  met: boolean;
  progress: number;
  rowCount: number;
  label: string | null;
  deadline: string | null;
  isOverdue: boolean;
}

export interface CreateTargetParams {
  goalId?: string;
  jobId?: string;
  projectId: string;
  dataTableId: string;
  columnId: string;
  targetValue: number;
  direction?: TargetDirection;
  aggregation?: TargetAggregation;
  label?: string;
  deadline?: string;
  createdBy?: TargetCreatedBy;
}

export interface UpdateTargetParams {
  id: string;
  targetValue?: number;
  direction?: TargetDirection;
  aggregation?: TargetAggregation;
  label?: string | null;
  deadline?: string | null;
}

export interface ListTargetsParams {
  goalId?: string;
  jobId?: string;
  projectId?: string;
  dataTableId?: string;
}

// ─── Visualization Types ───

export type ChartType = "line" | "bar" | "area" | "pie" | "stat";
export type VisualizationStatus = "active" | "suggested" | "dismissed";
export type VisualizationSource = "user" | "system";

export interface VisualizationSeriesConfig {
  columnId: string;
  label?: string;
  color?: string;
  aggregation?: TargetAggregation;
}

export interface VisualizationConfig {
  /** X-axis column ID (typically date for line/area, category for bar) */
  xColumnId?: string;
  /** Y-axis series — one or more columns to plot */
  series: VisualizationSeriesConfig[];
  /** For pie charts: value column */
  valueColumnId?: string;
  /** For pie charts: label column */
  labelColumnId?: string;
  /** For stat cards: single column */
  statColumnId?: string;
  /** For stat cards: aggregation method */
  statAggregation?: TargetAggregation;
  /** For stat cards: override label (defaults to column name) */
  statLabel?: string;
  /** Max rows to fetch (default: 500) */
  rowLimit?: number;
  /** Sort direction for x-axis */
  sortDirection?: "asc" | "desc";
  showLegend?: boolean;
  showGrid?: boolean;
  /** Custom color palette override */
  colors?: string[];
}

export interface Visualization {
  id: string;
  projectId: string;
  goalId: string | null;
  jobId: string | null;
  dataTableId: string;
  name: string;
  description: string | null;
  chartType: ChartType;
  config: VisualizationConfig;
  status: VisualizationStatus;
  source: VisualizationSource;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVisualizationParams {
  projectId: string;
  goalId?: string;
  jobId?: string;
  dataTableId: string;
  name: string;
  description?: string;
  chartType: ChartType;
  config: VisualizationConfig;
  status?: VisualizationStatus;
  source?: VisualizationSource;
}

export interface UpdateVisualizationParams {
  id: string;
  name?: string;
  description?: string | null;
  chartType?: ChartType;
  config?: VisualizationConfig;
  status?: VisualizationStatus;
  goalId?: string | null;
  jobId?: string | null;
}

export interface ListVisualizationsParams {
  projectId?: string;
  goalId?: string;
  jobId?: string;
  dataTableId?: string;
  status?: VisualizationStatus;
}

// ─── Inbox Event Types ───

export type InboxCategory = "alert" | "action" | "run" | "chat" | "memory" | "data" | "credential" | "insight" | "system";
export type InboxEventStatus = "active" | "resolved" | "dismissed";
export type InboxSourceType = "run" | "message" | "dashboard_item" | "memory" | "data_table" | "credential" | "proposal" | "job";

export interface InboxEvent {
  id: string;
  projectId: string | null;
  category: InboxCategory;
  eventType: string;
  importance: number;
  title: string;
  body: string | null;
  sourceId: string | null;
  sourceType: InboxSourceType | null;
  metadata: Record<string, unknown>;
  conversationId: string | null;
  replyToEventId: string | null;
  status: InboxEventStatus;
  resolvedAt: string | null;
  eventAt: string;
  createdAt: string;
}

export interface CreateInboxEventParams {
  projectId: string | null;
  category: InboxCategory;
  eventType: string;
  importance: number;
  title: string;
  body?: string;
  sourceId?: string;
  sourceType?: InboxSourceType;
  metadata?: Record<string, unknown>;
  conversationId?: string;
  replyToEventId?: string;
  eventAt?: string;
}

export interface ListInboxEventsParams {
  projectId?: string | null;
  category?: InboxCategory;
  status?: InboxEventStatus;
  minImportance?: number;
  before?: string;
  after?: string;
  limit?: number;
}

export interface ResolveInboxEventParams {
  id: string;
  status: "resolved" | "dismissed";
}

export interface SendInboxMessageParams {
  projectId: string | null;
  content: string;
  replyToEventId?: string;
  context?: ChatContext;
}

export interface InboxTierBoundaries {
  boundaries: number[];
  labels: string[];
}

export interface GetInboxTiersParams {
  projectId?: string | null;
  from: string;
  to: string;
}

export interface ListFutureInboxEventsParams {
  projectId?: string | null;
  limit?: number;
  /** Only return occurrences strictly after this ISO timestamp (for pagination). */
  after?: string;
}

// Re-export tiering utilities so they're accessible from @openhelm/shared
export { computeTierBoundaries, getTierForImportance } from "./inbox-tiering.js";

// ─── Voice Types ───

export type VoiceStatus =
  | "idle"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "awaiting-approval";

export type TtsEngine = "piper" | "kokoro" | "coqui-xtts";
export type VoiceInteractionMode = "conversation" | "push-to-talk";

// IPC Method Params

export interface StartVoiceParams {
  projectId: string | null;
  conversationId?: string;
  mode?: VoiceInteractionMode;
}

export interface VoiceAudioChunkParams {
  sessionId: string;
  /** Base64-encoded PCM Float32 at 16kHz mono */
  chunk: string;
  sequenceNum: number;
}

export interface StopVoiceParams {
  sessionId: string;
}

export interface CancelVoiceParams {
  sessionId: string;
}

export interface VoiceApproveParams {
  sessionId: string;
  messageId: string;
  decision: "approve" | "reject";
}

export interface GetVoiceSettingsResult {
  ttsEngine: TtsEngine;
  interactionMode: VoiceInteractionMode;
  selectedVoice: string;
  enabled: boolean;
}

export interface UpdateVoiceSettingsParams {
  ttsEngine?: TtsEngine;
  voiceId?: string;
  interactionMode?: VoiceInteractionMode;
}

// IPC Events

export interface VoiceStatusEvent {
  sessionId: string;
  status: VoiceStatus;
}

export interface VoiceTranscriptEvent {
  sessionId: string;
  text: string;
  interim: boolean;
}

export interface VoiceTtsChunkEvent {
  sessionId: string;
  /** Base64-encoded PCM Float32 */
  chunk: string;
  sampleRate: number;
  sequenceNum: number;
  final: boolean;
}

export interface VoiceActionPendingEvent {
  sessionId: string;
  messageId: string;
  actions: PendingAction[];
  spokenSummary: string;
}

export interface VoiceErrorEvent {
  sessionId: string;
  error: string;
  recoverable: boolean;
}
export type { TierConfig, TierResult } from "./inbox-tiering.js";

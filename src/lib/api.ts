import { transport } from "./transport";
import { useDemoStore } from "../stores/demo-store";
import type {
  Project,
  Goal,
  Job,
  Run,
  RunLog,
  Setting,
  SettingKey,
  DashboardItem,
  Memory,
  Credential,
  CredentialWithValue,
  AutopilotProposal,
  DataTable,
  DataTableRow,
  ListAutopilotProposalsParams,
  ApproveAutopilotProposalParams,
  CreateProjectParams,
  UpdateProjectParams,
  CreateGoalParams,
  UpdateGoalParams,
  ListGoalsParams,
  GoalDeleteSnapshot,
  CreateJobParams,
  UpdateJobParams,
  ListJobsParams,
  CreateRunParams,
  UpdateRunParams,
  ListRunsParams,
  CreateRunLogParams,
  ListRunLogsParams,
  SetSettingParams,
  CreateMemoryParams,
  UpdateMemoryParams,
  ListMemoriesParams,
  CreateCredentialParams,
  UpdateCredentialParams,
  ListCredentialsParams,
  ListCredentialsByScopeParams,
  CreateDataTableParams,
  UpdateDataTableParams,
  ListDataTablesParams,
  InsertDataTableRowsParams,
  UpdateDataTableRowParams,
  DeleteDataTableRowsParams,
  ListDataTableRowsParams,
  AddDataTableColumnParams,
  RenameDataTableColumnParams,
  RemoveDataTableColumnParams,
  UpdateDataTableColumnConfigParams,
  UpdateDataTableColumnParams,
  ReorderDataTableColumnsParams,
  Target,
  TargetEvaluation,
  CreateTargetParams,
  UpdateTargetParams,
  ListTargetsParams,
  Visualization,
  CreateVisualizationParams,
  UpdateVisualizationParams,
  ListVisualizationsParams,
  BulkReorderParams,
  ClaudeCodeDetectionResult,
  DetectClaudeCodeParams,
  VerifyClaudeCodeParams,
  TriggerRunParams,
  CancelRunParams,
  ClearRunsByJobParams,
  GetJobTokenStatsParams,
  JobTokenStat,
  GetRunToolStatsParams,
  RunToolStat,
  SchedulerStatus,
  ListDashboardItemsParams,
  ResolveDashboardItemParams,
  ChatMessage,
  SendChatMessageParams,
  CancelChatMessageParams,
  ApproveChatActionParams,
  RejectChatActionParams,
  ApproveAllChatActionsParams,
  RejectAllChatActionsParams,
  ListChatMessagesParams,
  ClearChatParams,
  Conversation,
  ListConversationsParams,
  CreateConversationParams,
  RenameConversationParams,
  DeleteConversationParams,
  ReorderConversationsParams,
  LicenseStatus,
  RequestEmailVerificationParams,
  EmailVerificationResult,
  CheckEmailVerificationParams,
  EmailVerificationStatus,
  CreateCheckoutSessionWithCurrencyParams,
  CheckoutSessionResult,
  PollCheckoutSessionParams,
  PollCheckoutSessionResult,
  CustomerPortalResult,
  PricingResult,
  UsageSummary,
  InboxEvent,
  ListInboxEventsParams,
  ResolveInboxEventParams,
  SendInboxMessageParams,
  GetInboxTiersParams,
  InboxTierBoundaries,
  ListFutureInboxEventsParams,
  SetupBrowserProfileParams,
  SetupBrowserProfileResult,
  FinalizeBrowserProfileParams,
  FinalizeBrowserProfileResult,
  SetLowTokenModeParams,
  SetLowTokenModeResult,
  StartVoiceParams,
  VoiceAudioChunkParams,
  StopVoiceParams,
  CancelVoiceParams,
  VoiceApproveParams,
  GetVoiceSettingsResult,
  UpdateVoiceSettingsParams,
  Connection,
  ConnectionWithValue,
  CreateConnectionParams,
  UpdateConnectionParams,
  ListConnectionsParams,
  ListConnectionsByScopeParams,
  McpRegistrySearchResult,
  CliCatalogEntry,
  ServiceSearchResult,
} from "@openhelm/shared";

// ─── Projects ───

export function createProject(params: CreateProjectParams): Promise<Project> {
  return transport.request<Project>("projects.create", params);
}

export function getProject(id: string): Promise<Project> {
  return transport.request<Project>("projects.get", { id });
}

export function getProjectBySlug(slug: string): Promise<Project | null> {
  return transport.request<Project | null>("projects.getBySlug", { slug });
}

export function listProjects(): Promise<Project[]> {
  return transport.request<Project[]>("projects.list");
}

export function updateProject(params: UpdateProjectParams): Promise<Project> {
  return transport.request<Project>("projects.update", params);
}

export function deleteProject(id: string): Promise<{ deleted: boolean }> {
  return transport.request<{ deleted: boolean }>("projects.delete", { id });
}

// ─── Goals ───

export function createGoal(params: CreateGoalParams): Promise<Goal> {
  return transport.request<Goal>("goals.create", params);
}

export function getGoal(id: string): Promise<Goal> {
  return transport.request<Goal>("goals.get", { id });
}

export function listGoals(params: ListGoalsParams): Promise<Goal[]> {
  return transport.request<Goal[]>("goals.list", params);
}

export function updateGoal(params: UpdateGoalParams): Promise<Goal> {
  return transport.request<Goal>("goals.update", params);
}

export function archiveGoal(id: string): Promise<Goal> {
  return transport.request<Goal>("goals.archive", { id });
}

export function unarchiveGoal(id: string): Promise<Goal> {
  return transport.request<Goal>("goals.unarchive", { id });
}

export function deleteGoal(id: string): Promise<{ deleted: boolean; snapshot: GoalDeleteSnapshot }> {
  return transport.request<{ deleted: boolean; snapshot: GoalDeleteSnapshot }>("goals.delete", { id });
}

export function reorderGoals(params: BulkReorderParams): Promise<{ ok: boolean }> {
  return transport.request<{ ok: boolean }>("goals.reorder", params);
}

export function getGoalChildren(goalId: string): Promise<Goal[]> {
  return transport.request<Goal[]>("goals.children", { id: goalId });
}

export function getGoalAncestors(goalId: string): Promise<Goal[]> {
  return transport.request<Goal[]>("goals.ancestors", { id: goalId });
}

export function restoreDeletedGoal(snapshot: GoalDeleteSnapshot): Promise<{ restored: number }> {
  return transport.request<{ restored: number }>("goals.restoreDeleted", { snapshot });
}

// ─── Jobs ───

export function createJob(params: CreateJobParams): Promise<Job> {
  return transport.request<Job>("jobs.create", params);
}

export function getJob(id: string): Promise<Job> {
  return transport.request<Job>("jobs.get", { id });
}

export function listJobs(params?: ListJobsParams): Promise<Job[]> {
  return transport.request<Job[]>("jobs.list", params);
}

export function updateJob(params: UpdateJobParams): Promise<Job> {
  return transport.request<Job>("jobs.update", params);
}

export function archiveJob(id: string): Promise<Job> {
  return transport.request<Job>("jobs.archive", { id });
}

export function unarchiveJob(id: string): Promise<Job> {
  return transport.request<Job>("jobs.unarchive", { id });
}

export function deleteJob(id: string): Promise<{ deleted: boolean }> {
  return transport.request<{ deleted: boolean }>("jobs.delete", { id });
}

export function reorderJobs(params: BulkReorderParams): Promise<{ ok: boolean }> {
  return transport.request<{ ok: boolean }>("jobs.reorder", params);
}

// ─── Runs ───

export function createRun(params: CreateRunParams): Promise<Run> {
  return transport.request<Run>("runs.create", params);
}

export function getRun(id: string): Promise<Run> {
  return transport.request<Run>("runs.get", { id });
}

export function listRuns(params?: ListRunsParams): Promise<Run[]> {
  return transport.request<Run[]>("runs.list", params);
}

export function updateRun(params: UpdateRunParams): Promise<Run> {
  return transport.request<Run>("runs.update", params);
}

export function deleteRun(id: string): Promise<{ deleted: boolean }> {
  return transport.request<{ deleted: boolean }>("runs.delete", { id });
}

// ─── Run Logs ───

export function createRunLog(params: CreateRunLogParams): Promise<RunLog> {
  return transport.request<RunLog>("runLogs.create", params);
}

export function listRunLogs(params: ListRunLogsParams): Promise<RunLog[]> {
  return transport.request<RunLog[]>("runLogs.list", params);
}

// ─── Settings ───

export function getSetting(key: SettingKey): Promise<Setting | null> {
  return transport.request<Setting | null>("settings.get", { key });
}

export function setSetting(params: SetSettingParams): Promise<Setting> {
  return transport.request<Setting>("settings.set", params);
}

export function deleteSetting(
  key: SettingKey,
): Promise<{ deleted: boolean }> {
  return transport.request<{ deleted: boolean }>("settings.delete", { key });
}

// ─── Claude Code ───

export function detectClaudeCode(
  params?: DetectClaudeCodeParams,
): Promise<ClaudeCodeDetectionResult> {
  return transport.request<ClaudeCodeDetectionResult>(
    "claudeCode.detect",
    params,
  );
}

export function verifyClaudeCode(
  params: VerifyClaudeCodeParams,
): Promise<ClaudeCodeDetectionResult> {
  return transport.request<ClaudeCodeDetectionResult>(
    "claudeCode.verify",
    params,
  );
}

export function getClaudeCodeStatus(): Promise<ClaudeCodeDetectionResult> {
  return transport.request<ClaudeCodeDetectionResult>(
    "claudeCode.getStatus",
  );
}

export interface ClaudeCodeHealthResult {
  healthy: boolean;
  authenticated: boolean;
  error?: string;
}

export function checkClaudeCodeHealth(): Promise<ClaudeCodeHealthResult> {
  return transport.request<ClaudeCodeHealthResult>(
    "claudeCode.checkHealth",
  );
}

// ─── Scheduler & Executor ───

export function triggerRun(params: TriggerRunParams): Promise<Run> {
  return transport.request<Run>("runs.trigger", params);
}

export function cancelRun(params: CancelRunParams): Promise<{ cancelled: boolean }> {
  return transport.request<{ cancelled: boolean }>("runs.cancel", params);
}

export function forceRunNow(runId: string): Promise<{ started: boolean }> {
  return transport.request<{ started: boolean }>("runs.forceRun", { runId });
}

export function clearRunsByJob(params: ClearRunsByJobParams): Promise<{ cleared: number }> {
  return transport.request<{ cleared: number }>("runs.clearByJob", params);
}

export function getJobTokenStats(params?: GetJobTokenStatsParams): Promise<JobTokenStat[]> {
  return transport.request<JobTokenStat[]>("runs.getTokenStats", params ?? {});
}

export function getRunToolStats(params?: GetRunToolStatsParams): Promise<RunToolStat[]> {
  return transport.request<RunToolStat[]>("runs.getToolStats", params ?? {});
}

export function openRunInTerminal(runId: string): Promise<{ opened: boolean }> {
  return transport.request<{ opened: boolean }>("runs.openInTerminal", { id: runId });
}

export function getSchedulerStatus(): Promise<SchedulerStatus> {
  return transport.request<SchedulerStatus>("scheduler.status");
}

export function pauseScheduler(): Promise<{ paused: boolean }> {
  return transport.request<{ paused: boolean }>("scheduler.pause");
}

export function resumeScheduler(): Promise<{ paused: boolean }> {
  return transport.request<{ paused: boolean }>("scheduler.resume");
}

export function stopAllRuns(): Promise<{ stoppedActive: number; clearedQueued: number }> {
  return transport.request<{ stoppedActive: number; clearedQueued: number }>("executor.stopAll");
}

export function setLowTokenMode(params: SetLowTokenModeParams): Promise<SetLowTokenModeResult> {
  return transport.request<SetLowTokenModeResult>("scheduler.setLowTokenMode", params);
}

// ─── Browser MCP ───

export function focusBrowserWindow(): Promise<{ success: boolean }> {
  return transport.request<{ success: boolean }>("browserMcp.focusBrowser");
}

// ─── Health ───

export function reAuthenticated(): Promise<{
  success: boolean;
  resumed: number;
  error?: string;
}> {
  return transport.request("health.reAuthenticated");
}

// ─── Chat ───

export function sendChatMessage(
  params: SendChatMessageParams,
): Promise<{ started: boolean }> {
  // In demo mode, attach the active slug so the worker can rate-limit
  // anonymous chat. The store import is safe — it's a tiny Zustand file
  // with no side effects on module load.
  const demoSlug = useDemoStore.getState().slug;
  const payload = demoSlug ? { ...params, demoSlug } : params;
  return transport.request<{ started: boolean }>("chat.send", payload);
}

export function cancelChatMessage(
  params: CancelChatMessageParams,
): Promise<{ cancelled: boolean }> {
  return transport.request<{ cancelled: boolean }>("chat.cancel", params);
}

export function approveChatAction(
  params: ApproveChatActionParams,
): Promise<ChatMessage> {
  return transport.request<ChatMessage>("chat.approveAction", params);
}

export function rejectChatAction(
  params: RejectChatActionParams,
): Promise<ChatMessage> {
  return transport.request<ChatMessage>("chat.rejectAction", params);
}

export function approveAllChatActions(
  params: ApproveAllChatActionsParams,
): Promise<ChatMessage> {
  return transport.request<ChatMessage>("chat.approveAll", params);
}

export function rejectAllChatActions(
  params: RejectAllChatActionsParams,
): Promise<ChatMessage> {
  return transport.request<ChatMessage>("chat.rejectAll", params);
}

export function listChatMessages(
  params: ListChatMessagesParams,
): Promise<ChatMessage[]> {
  return transport.request<ChatMessage[]>("chat.listMessages", params);
}

export function clearChat(params: ClearChatParams): Promise<{ cleared: boolean }> {
  return transport.request<{ cleared: boolean }>("chat.clear", params);
}

// ─── Conversation Threads ───

export function listConversations(params: ListConversationsParams): Promise<Conversation[]> {
  return transport.request<Conversation[]>("chat.listConversations", params);
}

export function createConversation(params: CreateConversationParams): Promise<Conversation> {
  return transport.request<Conversation>("chat.createConversation", params);
}

export function renameConversation(params: RenameConversationParams): Promise<Conversation> {
  return transport.request<Conversation>("chat.renameConversation", params);
}

export function deleteConversation(params: DeleteConversationParams): Promise<{ deleted: boolean }> {
  return transport.request<{ deleted: boolean }>("chat.deleteConversation", params);
}

export function reorderConversations(params: ReorderConversationsParams): Promise<{ reordered: boolean }> {
  return transport.request<{ reordered: boolean }>("chat.reorderConversations", params);
}

// ─── Dashboard ───

export function listDashboardItems(params?: ListDashboardItemsParams): Promise<DashboardItem[]> {
  return transport.request<DashboardItem[]>("dashboard.list", params);
}

export function countDashboardItems(projectId?: string): Promise<{ count: number }> {
  return transport.request<{ count: number }>("dashboard.count", { projectId });
}

export function resolveDashboardItem(params: ResolveDashboardItemParams): Promise<DashboardItem> {
  return transport.request<DashboardItem>("dashboard.resolve", params);
}

// ─── Memories ───

export function listMemories(params: ListMemoriesParams): Promise<Memory[]> {
  return transport.request<Memory[]>("memories.list", params);
}

export function getMemory(id: string): Promise<Memory> {
  return transport.request<Memory>("memories.get", { id });
}

export function createMemory(params: CreateMemoryParams): Promise<Memory> {
  return transport.request<Memory>("memories.create", params);
}

export function updateMemory(params: UpdateMemoryParams): Promise<Memory> {
  return transport.request<Memory>("memories.update", params);
}

export function deleteMemory(id: string): Promise<{ deleted: boolean }> {
  return transport.request<{ deleted: boolean }>("memories.delete", { id });
}

export function archiveMemory(id: string): Promise<Memory> {
  return transport.request<Memory>("memories.archive", { id });
}

export function listMemoryTags(projectId: string): Promise<string[]> {
  return transport.request<string[]>("memories.listTags", { projectId });
}

export function pruneMemories(projectId: string): Promise<{ pruned: number }> {
  return transport.request<{ pruned: number }>("memories.prune", { projectId });
}

export function countMemories(projectId: string): Promise<{ count: number }> {
  return transport.request<{ count: number }>("memories.count", { projectId });
}

export function listMemoriesForRun(runId: string): Promise<Memory[]> {
  return transport.request<Memory[]>("memories.listForRun", { runId });
}

// ─── Credentials ───

export function listCredentials(params?: ListCredentialsParams): Promise<Credential[]> {
  return transport.request<Credential[]>("credentials.list", params);
}

export function listAllCredentials(): Promise<Credential[]> {
  return transport.request<Credential[]>("credentials.listAll");
}

export function getCredentialValue(id: string): Promise<CredentialWithValue> {
  return transport.request<CredentialWithValue>("credentials.getValue", { id });
}

export function createCredential(params: CreateCredentialParams): Promise<Credential> {
  return transport.request<Credential>("credentials.create", params);
}

export function updateCredential(params: UpdateCredentialParams): Promise<Credential> {
  return transport.request<Credential>("credentials.update", params);
}

export function deleteCredential(id: string): Promise<{ deleted: boolean }> {
  return transport.request<{ deleted: boolean }>("credentials.delete", { id });
}

export function countCredentials(projectId?: string): Promise<{ count: number }> {
  return transport.request<{ count: number }>("credentials.count", { projectId });
}

export function countAllCredentials(): Promise<{ count: number }> {
  return transport.request<{ count: number }>("credentials.countAll");
}

export function listCredentialsByScope(params: ListCredentialsByScopeParams): Promise<Credential[]> {
  return transport.request<Credential[]>("credentials.listForScope", params);
}

export function setCredentialScopesForEntity(params: {
  scopeType: "project" | "goal" | "job";
  scopeId: string;
  credentialIds: string[];
}): Promise<{ added: number; removed: number }> {
  return transport.request("credentials.setScopesForEntity", params);
}

// ─── Browser Profile Setup ───

export function setupBrowserProfile(
  params: SetupBrowserProfileParams,
): Promise<SetupBrowserProfileResult> {
  return transport.request<SetupBrowserProfileResult>(
    "credential.setupBrowserProfile",
    params,
  );
}

export function finalizeBrowserProfile(
  params: FinalizeBrowserProfileParams,
): Promise<FinalizeBrowserProfileResult> {
  return transport.request<FinalizeBrowserProfileResult>(
    "credential.finalizeBrowserProfile",
    params,
  );
}

/**
 * Cancel an in-flight browser setup.
 *
 * Local (Tauri) mode: keyed by credentialId — the agent monitor is indexed
 * by credential, and only one browser is open per credential at a time.
 *
 * Cloud mode: keyed by sandboxId — the Worker tracks sandboxes directly so
 * one user could theoretically have multiple setups mid-flight.
 */
export function cancelBrowserSetup(
  keyOrParams: string | { credentialId?: string; sandboxId?: string },
): Promise<{ cancelled: boolean }> {
  const params =
    typeof keyOrParams === "string" ? { credentialId: keyOrParams } : keyOrParams;
  return transport.request("credential.cancelBrowserSetup", params);
}

// ─── Connections ───

export function listConnections(params?: ListConnectionsParams): Promise<Connection[]> {
  return transport.request<Connection[]>("connections.list", params);
}

export function listAllConnections(): Promise<Connection[]> {
  return transport.request<Connection[]>("connections.listAll");
}

export function getConnection(id: string): Promise<Connection> {
  return transport.request<Connection>("connections.get", { id });
}

export function getConnectionValue(id: string): Promise<ConnectionWithValue> {
  return transport.request<ConnectionWithValue>("connections.getValue", { id });
}

export function createConnection(params: CreateConnectionParams): Promise<Connection> {
  return transport.request<Connection>("connections.create", params);
}

export function updateConnection(params: UpdateConnectionParams): Promise<Connection> {
  return transport.request<Connection>("connections.update", params);
}

export function deleteConnection(id: string): Promise<{ deleted: boolean }> {
  return transport.request<{ deleted: boolean }>("connections.delete", { id });
}

export function countConnections(projectId?: string): Promise<{ count: number }> {
  return transport.request<{ count: number }>("connections.count", { projectId });
}

export function countAllConnections(): Promise<{ count: number }> {
  return transport.request<{ count: number }>("connections.countAll");
}

export function listConnectionsByScope(params: ListConnectionsByScopeParams): Promise<Connection[]> {
  return transport.request<Connection[]>("connections.listForScope", params);
}

export function setConnectionScopesForEntity(params: {
  scopeType: "project" | "goal" | "job";
  scopeId: string;
  connectionIds: string[];
}): Promise<{ added: number; removed: number }> {
  return transport.request("connections.setScopesForEntity", params);
}

export function searchMcpRegistry(query: string, limit?: number): Promise<McpRegistrySearchResult[]> {
  return transport.request<McpRegistrySearchResult[]>("connections.searchMcpRegistry", { query, limit });
}

export function searchServices(
  query: string,
  options?: { limit?: number; includeMcpRegistry?: boolean },
): Promise<ServiceSearchResult[]> {
  return transport.request<ServiceSearchResult[]>("connections.searchServices", { query, ...options });
}

export function searchCliRegistry(query: string): Promise<CliCatalogEntry[]> {
  return transport.request<CliCatalogEntry[]>("connections.searchCliRegistry", { query });
}

export function installMcpConnection(params: {
  mcpServerId: string;
  name?: string;
  installCommand?: string[];
  scopes?: Array<{scopeType: string; scopeId: string}>;
}): Promise<{ connectionId: string; installStatus: string }> {
  return transport.request("connections.installMcp", params);
}

export function installCliConnection(cliId: string, scopes?: Array<{scopeType: string; scopeId: string}>): Promise<{ connectionId: string; installStatus: string }> {
  return transport.request("connections.installCli", { cliId, scopes });
}

export function reinstallConnection(connectionId: string): Promise<{ connectionId: string; installStatus: string }> {
  return transport.request("connections.reinstall", { connectionId });
}

export function startCliAuth(connectionId: string): Promise<{ method: string; deviceCode?: string; verificationUrl?: string; instructions: string }> {
  return transport.request("connections.startCliAuth", { connectionId });
}

export function completeCliAuth(connectionId: string): Promise<{ authenticated: boolean; timedOut: boolean }> {
  return transport.request("connections.completeCliAuth", { connectionId });
}

export function getMcpOauthConfig(connectionId: string): Promise<{
  oauthRequired: boolean;
  config?: { authorizationEndpoint: string; tokenEndpoint: string; clientId: string; scope: string; redirectUri: string };
}> {
  return transport.request("connections.getMcpOauthConfig", { connectionId });
}

export function setConnectionToken(connectionId: string, token: string): Promise<Connection> {
  return transport.request<Connection>("connections.setToken", { connectionId, token });
}

export function startMcpOauth(params: {
  connectionId: string;
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  tokenEndpoint: string;
}): Promise<{ authorizationUrl: string; state: string }> {
  return transport.request("connections.startMcpOauth", params);
}

export function completeMcpOauth(params: {
  connectionId: string;
  code: string;
  state: string;
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
}): Promise<Connection> {
  return transport.request<Connection>("connections.completeMcpOauth", params);
}

// ─── Data Import/Export ───

export function getExportStats(): Promise<import("@openhelm/shared").ExportStatsResult> {
  return transport.request("data.exportStats");
}

export function exportData(params: import("@openhelm/shared").ExportParams): Promise<import("@openhelm/shared").ExportResult> {
  return transport.request("data.export", params);
}

export function previewImport(params: import("@openhelm/shared").ImportParams): Promise<import("@openhelm/shared").ImportPreviewResult> {
  return transport.request("data.importPreview", params);
}

export function executeImport(params: import("@openhelm/shared").ImportExecuteParams): Promise<import("@openhelm/shared").ImportResult> {
  return transport.request("data.importExecute", params);
}

export function fixProjectPath(params: import("@openhelm/shared").FixProjectPathParams): Promise<Project> {
  return transport.request("data.fixProjectPath", params);
}

/** Cross-project memory queries (All Projects mode) */
export function listAllMemories(params?: Omit<ListMemoriesParams, "projectId">): Promise<Memory[]> {
  return transport.request<Memory[]>("memories.listAll", params);
}

export function listAllMemoryTags(): Promise<string[]> {
  return transport.request<string[]>("memories.listAllTags");
}

export function countAllMemories(): Promise<{ count: number }> {
  return transport.request<{ count: number }>("memories.countAll");
}

// ── Permissions ──────────────────────────────────────────────────────────────

export function requestTerminalAccess(): Promise<{ granted: boolean; error?: string }> {
  return transport.request<{ granted: boolean; error?: string }>("permissions.requestTerminalAccess");
}

export function checkTerminalAccess(): Promise<{ granted: boolean }> {
  return transport.request<{ granted: boolean }>("permissions.checkTerminalAccess");
}

// ── Power management ──────────────────────────────────────────────────────────

export function checkWakeAuth(): Promise<{ authorized: boolean; error?: string }> {
  return transport.request<{ authorized: boolean; error?: string }>("power.isAuthorized", {});
}

export function installWakeAuth(): Promise<{ authorized: boolean; error?: string }> {
  return transport.request<{ authorized: boolean; error?: string }>("power.checkAuth", {});
}

export function getPowerStatus(): Promise<{
  enabled: boolean;
  scheduledWakes: number;
  sleepGuardActive: boolean;
}> {
  return transport.request("power.status");
}

// ─── License ───

export function getLicenseStatus(): Promise<LicenseStatus> {
  return transport.request<LicenseStatus>("license.getStatus");
}

export function requestEmailVerification(
  params: RequestEmailVerificationParams,
): Promise<EmailVerificationResult> {
  return transport.request<EmailVerificationResult>(
    "license.requestEmailVerification",
    params,
  );
}

export function checkEmailVerification(
  params: CheckEmailVerificationParams,
): Promise<EmailVerificationStatus> {
  return transport.request<EmailVerificationStatus>(
    "license.checkEmailVerification",
    params,
  );
}

export function getPricing(): Promise<PricingResult> {
  return transport.request<PricingResult>("license.getPricing");
}

export function createCheckoutSession(
  params: CreateCheckoutSessionWithCurrencyParams,
): Promise<CheckoutSessionResult> {
  return transport.request<CheckoutSessionResult>(
    "license.createCheckoutSession",
    params,
  );
}

export function pollCheckoutSession(
  params: PollCheckoutSessionParams,
): Promise<PollCheckoutSessionResult> {
  return transport.request<PollCheckoutSessionResult>(
    "license.pollCheckoutSession",
    params,
  );
}

export function createPortalSession(): Promise<CustomerPortalResult> {
  return transport.request<CustomerPortalResult>(
    "license.createPortalSession",
  );
}

export function verifyLicense(): Promise<LicenseStatus> {
  return transport.request<LicenseStatus>("license.verify");
}

// ─── Autopilot ───

export function listAutopilotProposals(
  params?: ListAutopilotProposalsParams,
): Promise<AutopilotProposal[]> {
  return transport.request<AutopilotProposal[]>("autopilot.listProposals", params ?? {});
}

export function approveAutopilotProposal(
  params: ApproveAutopilotProposalParams,
): Promise<{ proposal: AutopilotProposal; jobIds: string[] }> {
  return transport.request<{ proposal: AutopilotProposal; jobIds: string[] }>(
    "autopilot.approveProposal",
    params,
  );
}

export function rejectAutopilotProposal(id: string): Promise<AutopilotProposal> {
  return transport.request<AutopilotProposal>("autopilot.rejectProposal", { id });
}

export function generateAutopilotForGoal(
  goalId: string,
  projectId: string,
): Promise<{ success: boolean }> {
  return transport.request<{ success: boolean }>("autopilot.generateForGoal", { goalId, projectId });
}

// ─── Data Tables ───

export function listDataTables(params: ListDataTablesParams): Promise<DataTable[]> {
  return transport.request<DataTable[]>("dataTables.list", params);
}

export function listAllDataTables(): Promise<DataTable[]> {
  return transport.request<DataTable[]>("dataTables.listAll");
}

export function getDataTable(id: string): Promise<DataTable> {
  return transport.request<DataTable>("dataTables.get", { id });
}

export function createDataTable(params: CreateDataTableParams): Promise<DataTable> {
  return transport.request<DataTable>("dataTables.create", params);
}

export function updateDataTable(params: UpdateDataTableParams): Promise<DataTable> {
  return transport.request<DataTable>("dataTables.update", params);
}

export function deleteDataTable(id: string): Promise<{ deleted: boolean }> {
  return transport.request<{ deleted: boolean }>("dataTables.delete", { id });
}

export function listDataTableRows(params: ListDataTableRowsParams): Promise<DataTableRow[]> {
  return transport.request<DataTableRow[]>("dataTables.listRows", params);
}

export function insertDataTableRows(params: InsertDataTableRowsParams): Promise<DataTableRow[]> {
  return transport.request<DataTableRow[]>("dataTables.insertRows", params);
}

export function updateDataTableRow(params: UpdateDataTableRowParams): Promise<DataTableRow> {
  return transport.request<DataTableRow>("dataTables.updateRow", params);
}

export function deleteDataTableRows(params: DeleteDataTableRowsParams): Promise<{ deleted: number }> {
  return transport.request<{ deleted: number }>("dataTables.deleteRows", params);
}

export function addDataTableColumn(params: AddDataTableColumnParams): Promise<DataTable> {
  return transport.request<DataTable>("dataTables.addColumn", params);
}

export function renameDataTableColumn(params: RenameDataTableColumnParams): Promise<DataTable> {
  return transport.request<DataTable>("dataTables.renameColumn", params);
}

export function removeDataTableColumn(params: RemoveDataTableColumnParams): Promise<DataTable> {
  return transport.request<DataTable>("dataTables.removeColumn", params);
}

export function updateDataTableColumnConfig(params: UpdateDataTableColumnConfigParams): Promise<DataTable> {
  return transport.request<DataTable>("dataTables.updateColumnConfig", params);
}

export function updateDataTableColumn(params: UpdateDataTableColumnParams): Promise<DataTable> {
  return transport.request<DataTable>("dataTables.updateColumn", params);
}

export function reorderDataTableColumns(params: ReorderDataTableColumnsParams): Promise<DataTable> {
  return transport.request<DataTable>("dataTables.reorderColumns", params);
}

export function countDataTables(projectId: string): Promise<{ count: number }> {
  return transport.request<{ count: number }>("dataTables.count", { projectId });
}

export function countAllDataTables(): Promise<{ count: number }> {
  return transport.request<{ count: number }>("dataTables.countAll");
}

// ─── Targets ───

export function listTargets(params: ListTargetsParams): Promise<Target[]> {
  return transport.request<Target[]>("targets.list", params);
}

export function createTarget(params: CreateTargetParams): Promise<Target> {
  return transport.request<Target>("targets.create", params);
}

export function updateTarget(params: UpdateTargetParams): Promise<Target> {
  return transport.request<Target>("targets.update", params);
}

export function deleteTarget(id: string): Promise<{ deleted: boolean }> {
  return transport.request<{ deleted: boolean }>("targets.delete", { id });
}

export function evaluateTargets(params: { goalId?: string; jobId?: string }): Promise<TargetEvaluation[]> {
  return transport.request<TargetEvaluation[]>("targets.evaluateAll", params);
}

// ─── Visualizations ───

export function listVisualizations(params: ListVisualizationsParams): Promise<Visualization[]> {
  return transport.request<Visualization[]>("visualizations.list", params);
}

export function listAllVisualizations(): Promise<Visualization[]> {
  return transport.request<Visualization[]>("visualizations.listAll");
}

export function createVisualization(params: CreateVisualizationParams): Promise<Visualization> {
  return transport.request<Visualization>("visualizations.create", params);
}

export function updateVisualization(params: UpdateVisualizationParams): Promise<Visualization> {
  return transport.request<Visualization>("visualizations.update", params);
}

export function deleteVisualization(id: string): Promise<{ deleted: boolean }> {
  return transport.request<{ deleted: boolean }>("visualizations.delete", { id });
}

export function acceptVisualization(id: string): Promise<Visualization> {
  return transport.request<Visualization>("visualizations.accept", { id });
}

export function dismissVisualization(id: string): Promise<Visualization> {
  return transport.request<Visualization>("visualizations.dismiss", { id });
}

// ─── Claude Code Usage ───

export function getUsageSummary(): Promise<UsageSummary> {
  return transport.request<UsageSummary>("usage.getSummary");
}

// ─── Autopilot Scanner ───

export function getAutopilotStatus(): Promise<{ intervalMinutes: number }> {
  return transport.request("autopilot.getStatus");
}

export function forceAutopilotScan(): Promise<{ success: boolean }> {
  return transport.request("autopilot.forceScan");
}

// ─── Inbox ───

export function listInboxEvents(params?: ListInboxEventsParams): Promise<InboxEvent[]> {
  return transport.request<InboxEvent[]>("inbox.list", params);
}

export function resolveInboxEvent(params: ResolveInboxEventParams): Promise<InboxEvent> {
  return transport.request<InboxEvent>("inbox.resolve", params);
}

export function sendInboxMessage(params: SendInboxMessageParams): Promise<{ started: boolean; conversationId: string }> {
  return transport.request("inbox.sendMessage", params);
}

export function countInboxEvents(params?: { projectId?: string; status?: string }): Promise<{ count: number }> {
  return transport.request<{ count: number }>("inbox.count", params);
}

export function getInboxTierBoundaries(params: GetInboxTiersParams): Promise<InboxTierBoundaries> {
  return transport.request("inbox.getTierBoundaries", params);
}

export function listFutureInboxEvents(params?: ListFutureInboxEventsParams): Promise<InboxEvent[]> {
  return transport.request<InboxEvent[]>("inbox.listFuture", params);
}

// ─── Voice ───

export function startVoice(params: StartVoiceParams): Promise<{ sessionId: string; started: boolean }> {
  return transport.request<{ sessionId: string; started: boolean }>("voice.start", params);
}

export function sendVoiceAudioChunk(params: VoiceAudioChunkParams): Promise<{ received: boolean }> {
  return transport.request<{ received: boolean }>("voice.audioChunk", params);
}

export function stopVoice(params: StopVoiceParams): Promise<{ stopped: boolean }> {
  return transport.request<{ stopped: boolean }>("voice.stop", params);
}

export function cancelVoice(params: CancelVoiceParams): Promise<{ cancelled: boolean }> {
  return transport.request<{ cancelled: boolean }>("voice.cancel", params);
}

export function notifyVoiceTtsPlaybackDone(sessionId: string): Promise<{ ok: boolean }> {
  return transport.request<{ ok: boolean }>("voice.ttsPlaybackDone", { sessionId });
}

export function approveVoiceAction(params: VoiceApproveParams): Promise<{ ok: boolean }> {
  return transport.request<{ ok: boolean }>("voice.approve", params);
}

export function getVoiceSettings(): Promise<GetVoiceSettingsResult> {
  return transport.request<GetVoiceSettingsResult>("voice.getSettings");
}

export function updateVoiceSettings(params: UpdateVoiceSettingsParams): Promise<{ updated: boolean }> {
  return transport.request<{ updated: boolean }>("voice.updateSettings", params);
}

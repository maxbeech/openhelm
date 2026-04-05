import { agentClient } from "./agent-client";
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
  SetLowTokenModeParams,
  SetLowTokenModeResult,
} from "@openhelm/shared";

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

export function archiveGoal(id: string): Promise<Goal> {
  return agentClient.request<Goal>("goals.archive", { id });
}

export function unarchiveGoal(id: string): Promise<Goal> {
  return agentClient.request<Goal>("goals.unarchive", { id });
}

export function deleteGoal(id: string): Promise<{ deleted: boolean; snapshot: GoalDeleteSnapshot }> {
  return agentClient.request<{ deleted: boolean; snapshot: GoalDeleteSnapshot }>("goals.delete", { id });
}

export function reorderGoals(params: BulkReorderParams): Promise<{ ok: boolean }> {
  return agentClient.request<{ ok: boolean }>("goals.reorder", params);
}

export function getGoalChildren(goalId: string): Promise<Goal[]> {
  return agentClient.request<Goal[]>("goals.children", { id: goalId });
}

export function getGoalAncestors(goalId: string): Promise<Goal[]> {
  return agentClient.request<Goal[]>("goals.ancestors", { id: goalId });
}

export function restoreDeletedGoal(snapshot: GoalDeleteSnapshot): Promise<{ restored: number }> {
  return agentClient.request<{ restored: number }>("goals.restoreDeleted", { snapshot });
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

export function archiveJob(id: string): Promise<Job> {
  return agentClient.request<Job>("jobs.archive", { id });
}

export function unarchiveJob(id: string): Promise<Job> {
  return agentClient.request<Job>("jobs.unarchive", { id });
}

export function deleteJob(id: string): Promise<{ deleted: boolean }> {
  return agentClient.request<{ deleted: boolean }>("jobs.delete", { id });
}

export function reorderJobs(params: BulkReorderParams): Promise<{ ok: boolean }> {
  return agentClient.request<{ ok: boolean }>("jobs.reorder", params);
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

export interface ClaudeCodeHealthResult {
  healthy: boolean;
  authenticated: boolean;
  error?: string;
}

export function checkClaudeCodeHealth(): Promise<ClaudeCodeHealthResult> {
  return agentClient.request<ClaudeCodeHealthResult>(
    "claudeCode.checkHealth",
  );
}

// ─── Scheduler & Executor ───

export function triggerRun(params: TriggerRunParams): Promise<Run> {
  return agentClient.request<Run>("runs.trigger", params);
}

export function cancelRun(params: CancelRunParams): Promise<{ cancelled: boolean }> {
  return agentClient.request<{ cancelled: boolean }>("runs.cancel", params);
}

export function clearRunsByJob(params: ClearRunsByJobParams): Promise<{ cleared: number }> {
  return agentClient.request<{ cleared: number }>("runs.clearByJob", params);
}

export function getJobTokenStats(params?: GetJobTokenStatsParams): Promise<JobTokenStat[]> {
  return agentClient.request<JobTokenStat[]>("runs.getTokenStats", params ?? {});
}

export function openRunInTerminal(runId: string): Promise<{ opened: boolean }> {
  return agentClient.request<{ opened: boolean }>("runs.openInTerminal", { id: runId });
}

export function getSchedulerStatus(): Promise<SchedulerStatus> {
  return agentClient.request<SchedulerStatus>("scheduler.status");
}

export function pauseScheduler(): Promise<{ paused: boolean }> {
  return agentClient.request<{ paused: boolean }>("scheduler.pause");
}

export function resumeScheduler(): Promise<{ paused: boolean }> {
  return agentClient.request<{ paused: boolean }>("scheduler.resume");
}

export function stopAllRuns(): Promise<{ stoppedActive: number; clearedQueued: number }> {
  return agentClient.request<{ stoppedActive: number; clearedQueued: number }>("executor.stopAll");
}

export function setLowTokenMode(params: SetLowTokenModeParams): Promise<SetLowTokenModeResult> {
  return agentClient.request<SetLowTokenModeResult>("scheduler.setLowTokenMode", params);
}

// ─── Browser MCP ───

export function focusBrowserWindow(): Promise<{ success: boolean }> {
  return agentClient.request<{ success: boolean }>("browserMcp.focusBrowser");
}

// ─── Health ───

export function reAuthenticated(): Promise<{
  success: boolean;
  resumed: number;
  error?: string;
}> {
  return agentClient.request("health.reAuthenticated");
}

// ─── Chat ───

export function sendChatMessage(
  params: SendChatMessageParams,
): Promise<{ started: boolean }> {
  return agentClient.request<{ started: boolean }>("chat.send", params);
}

export function cancelChatMessage(
  params: CancelChatMessageParams,
): Promise<{ cancelled: boolean }> {
  return agentClient.request<{ cancelled: boolean }>("chat.cancel", params);
}

export function approveChatAction(
  params: ApproveChatActionParams,
): Promise<ChatMessage> {
  return agentClient.request<ChatMessage>("chat.approveAction", params);
}

export function rejectChatAction(
  params: RejectChatActionParams,
): Promise<ChatMessage> {
  return agentClient.request<ChatMessage>("chat.rejectAction", params);
}

export function approveAllChatActions(
  params: ApproveAllChatActionsParams,
): Promise<ChatMessage> {
  return agentClient.request<ChatMessage>("chat.approveAll", params);
}

export function rejectAllChatActions(
  params: RejectAllChatActionsParams,
): Promise<ChatMessage> {
  return agentClient.request<ChatMessage>("chat.rejectAll", params);
}

export function listChatMessages(
  params: ListChatMessagesParams,
): Promise<ChatMessage[]> {
  return agentClient.request<ChatMessage[]>("chat.listMessages", params);
}

export function clearChat(params: ClearChatParams): Promise<{ cleared: boolean }> {
  return agentClient.request<{ cleared: boolean }>("chat.clear", params);
}

// ─── Conversation Threads ───

export function listConversations(params: ListConversationsParams): Promise<Conversation[]> {
  return agentClient.request<Conversation[]>("chat.listConversations", params);
}

export function createConversation(params: CreateConversationParams): Promise<Conversation> {
  return agentClient.request<Conversation>("chat.createConversation", params);
}

export function renameConversation(params: RenameConversationParams): Promise<Conversation> {
  return agentClient.request<Conversation>("chat.renameConversation", params);
}

export function deleteConversation(params: DeleteConversationParams): Promise<{ deleted: boolean }> {
  return agentClient.request<{ deleted: boolean }>("chat.deleteConversation", params);
}

export function reorderConversations(params: ReorderConversationsParams): Promise<{ reordered: boolean }> {
  return agentClient.request<{ reordered: boolean }>("chat.reorderConversations", params);
}

// ─── Dashboard ───

export function listDashboardItems(params?: ListDashboardItemsParams): Promise<DashboardItem[]> {
  return agentClient.request<DashboardItem[]>("dashboard.list", params);
}

export function countDashboardItems(projectId?: string): Promise<{ count: number }> {
  return agentClient.request<{ count: number }>("dashboard.count", { projectId });
}

export function resolveDashboardItem(params: ResolveDashboardItemParams): Promise<DashboardItem> {
  return agentClient.request<DashboardItem>("dashboard.resolve", params);
}

// ─── Memories ───

export function listMemories(params: ListMemoriesParams): Promise<Memory[]> {
  return agentClient.request<Memory[]>("memories.list", params);
}

export function getMemory(id: string): Promise<Memory> {
  return agentClient.request<Memory>("memories.get", { id });
}

export function createMemory(params: CreateMemoryParams): Promise<Memory> {
  return agentClient.request<Memory>("memories.create", params);
}

export function updateMemory(params: UpdateMemoryParams): Promise<Memory> {
  return agentClient.request<Memory>("memories.update", params);
}

export function deleteMemory(id: string): Promise<{ deleted: boolean }> {
  return agentClient.request<{ deleted: boolean }>("memories.delete", { id });
}

export function archiveMemory(id: string): Promise<Memory> {
  return agentClient.request<Memory>("memories.archive", { id });
}

export function listMemoryTags(projectId: string): Promise<string[]> {
  return agentClient.request<string[]>("memories.listTags", { projectId });
}

export function pruneMemories(projectId: string): Promise<{ pruned: number }> {
  return agentClient.request<{ pruned: number }>("memories.prune", { projectId });
}

export function countMemories(projectId: string): Promise<{ count: number }> {
  return agentClient.request<{ count: number }>("memories.count", { projectId });
}

export function listMemoriesForRun(runId: string): Promise<Memory[]> {
  return agentClient.request<Memory[]>("memories.listForRun", { runId });
}

// ─── Credentials ───

export function listCredentials(params?: ListCredentialsParams): Promise<Credential[]> {
  return agentClient.request<Credential[]>("credentials.list", params);
}

export function listAllCredentials(): Promise<Credential[]> {
  return agentClient.request<Credential[]>("credentials.listAll");
}

export function getCredentialValue(id: string): Promise<CredentialWithValue> {
  return agentClient.request<CredentialWithValue>("credentials.getValue", { id });
}

export function createCredential(params: CreateCredentialParams): Promise<Credential> {
  return agentClient.request<Credential>("credentials.create", params);
}

export function updateCredential(params: UpdateCredentialParams): Promise<Credential> {
  return agentClient.request<Credential>("credentials.update", params);
}

export function deleteCredential(id: string): Promise<{ deleted: boolean }> {
  return agentClient.request<{ deleted: boolean }>("credentials.delete", { id });
}

export function countCredentials(projectId?: string): Promise<{ count: number }> {
  return agentClient.request<{ count: number }>("credentials.count", { projectId });
}

export function countAllCredentials(): Promise<{ count: number }> {
  return agentClient.request<{ count: number }>("credentials.countAll");
}

export function listCredentialsByScope(params: ListCredentialsByScopeParams): Promise<Credential[]> {
  return agentClient.request<Credential[]>("credentials.listForScope", params);
}

export function setCredentialScopesForEntity(params: {
  scopeType: "project" | "goal" | "job";
  scopeId: string;
  credentialIds: string[];
}): Promise<{ added: number; removed: number }> {
  return agentClient.request("credentials.setScopesForEntity", params);
}

// ─── Browser Profile Setup ───

export function setupBrowserProfile(params: SetupBrowserProfileParams): Promise<SetupBrowserProfileResult> {
  return agentClient.request<SetupBrowserProfileResult>("credential.setupBrowserProfile", params);
}

export function cancelBrowserSetup(credentialId: string): Promise<{ cancelled: boolean }> {
  return agentClient.request("credential.cancelBrowserSetup", { credentialId });
}

// ─── Data Import/Export ───

export function getExportStats(): Promise<import("@openhelm/shared").ExportStatsResult> {
  return agentClient.request("data.exportStats");
}

export function exportData(params: import("@openhelm/shared").ExportParams): Promise<import("@openhelm/shared").ExportResult> {
  return agentClient.request("data.export", params);
}

export function previewImport(params: import("@openhelm/shared").ImportParams): Promise<import("@openhelm/shared").ImportPreviewResult> {
  return agentClient.request("data.importPreview", params);
}

export function executeImport(params: import("@openhelm/shared").ImportExecuteParams): Promise<import("@openhelm/shared").ImportResult> {
  return agentClient.request("data.importExecute", params);
}

export function fixProjectPath(params: import("@openhelm/shared").FixProjectPathParams): Promise<Project> {
  return agentClient.request("data.fixProjectPath", params);
}

/** Cross-project memory queries (All Projects mode) */
export function listAllMemories(params?: Omit<ListMemoriesParams, "projectId">): Promise<Memory[]> {
  return agentClient.request<Memory[]>("memories.listAll", params);
}

export function listAllMemoryTags(): Promise<string[]> {
  return agentClient.request<string[]>("memories.listAllTags");
}

export function countAllMemories(): Promise<{ count: number }> {
  return agentClient.request<{ count: number }>("memories.countAll");
}

// ── Permissions ──────────────────────────────────────────────────────────────

export function requestTerminalAccess(): Promise<{ granted: boolean; error?: string }> {
  return agentClient.request<{ granted: boolean; error?: string }>("permissions.requestTerminalAccess");
}

export function checkTerminalAccess(): Promise<{ granted: boolean }> {
  return agentClient.request<{ granted: boolean }>("permissions.checkTerminalAccess");
}

// ── Power management ──────────────────────────────────────────────────────────

export function checkWakeAuth(): Promise<{ authorized: boolean; error?: string }> {
  return agentClient.request<{ authorized: boolean; error?: string }>("power.isAuthorized", {});
}

export function installWakeAuth(): Promise<{ authorized: boolean; error?: string }> {
  return agentClient.request<{ authorized: boolean; error?: string }>("power.checkAuth", {});
}

export function getPowerStatus(): Promise<{
  enabled: boolean;
  scheduledWakes: number;
  sleepGuardActive: boolean;
}> {
  return agentClient.request("power.status");
}

// ─── License ───

export function getLicenseStatus(): Promise<LicenseStatus> {
  return agentClient.request<LicenseStatus>("license.getStatus");
}

export function requestEmailVerification(
  params: RequestEmailVerificationParams,
): Promise<EmailVerificationResult> {
  return agentClient.request<EmailVerificationResult>(
    "license.requestEmailVerification",
    params,
  );
}

export function checkEmailVerification(
  params: CheckEmailVerificationParams,
): Promise<EmailVerificationStatus> {
  return agentClient.request<EmailVerificationStatus>(
    "license.checkEmailVerification",
    params,
  );
}

export function getPricing(): Promise<PricingResult> {
  return agentClient.request<PricingResult>("license.getPricing");
}

export function createCheckoutSession(
  params: CreateCheckoutSessionWithCurrencyParams,
): Promise<CheckoutSessionResult> {
  return agentClient.request<CheckoutSessionResult>(
    "license.createCheckoutSession",
    params,
  );
}

export function pollCheckoutSession(
  params: PollCheckoutSessionParams,
): Promise<PollCheckoutSessionResult> {
  return agentClient.request<PollCheckoutSessionResult>(
    "license.pollCheckoutSession",
    params,
  );
}

export function createPortalSession(): Promise<CustomerPortalResult> {
  return agentClient.request<CustomerPortalResult>(
    "license.createPortalSession",
  );
}

export function verifyLicense(): Promise<LicenseStatus> {
  return agentClient.request<LicenseStatus>("license.verify");
}

// ─── Autopilot ───

export function listAutopilotProposals(
  params?: ListAutopilotProposalsParams,
): Promise<AutopilotProposal[]> {
  return agentClient.request<AutopilotProposal[]>("autopilot.listProposals", params ?? {});
}

export function approveAutopilotProposal(
  params: ApproveAutopilotProposalParams,
): Promise<{ proposal: AutopilotProposal; jobIds: string[] }> {
  return agentClient.request<{ proposal: AutopilotProposal; jobIds: string[] }>(
    "autopilot.approveProposal",
    params,
  );
}

export function rejectAutopilotProposal(id: string): Promise<AutopilotProposal> {
  return agentClient.request<AutopilotProposal>("autopilot.rejectProposal", { id });
}

export function generateAutopilotForGoal(
  goalId: string,
  projectId: string,
): Promise<{ success: boolean }> {
  return agentClient.request<{ success: boolean }>("autopilot.generateForGoal", { goalId, projectId });
}

// ─── Data Tables ───

export function listDataTables(params: ListDataTablesParams): Promise<DataTable[]> {
  return agentClient.request<DataTable[]>("dataTables.list", params);
}

export function listAllDataTables(): Promise<DataTable[]> {
  return agentClient.request<DataTable[]>("dataTables.listAll");
}

export function getDataTable(id: string): Promise<DataTable> {
  return agentClient.request<DataTable>("dataTables.get", { id });
}

export function createDataTable(params: CreateDataTableParams): Promise<DataTable> {
  return agentClient.request<DataTable>("dataTables.create", params);
}

export function updateDataTable(params: UpdateDataTableParams): Promise<DataTable> {
  return agentClient.request<DataTable>("dataTables.update", params);
}

export function deleteDataTable(id: string): Promise<{ deleted: boolean }> {
  return agentClient.request<{ deleted: boolean }>("dataTables.delete", { id });
}

export function listDataTableRows(params: ListDataTableRowsParams): Promise<DataTableRow[]> {
  return agentClient.request<DataTableRow[]>("dataTables.listRows", params);
}

export function insertDataTableRows(params: InsertDataTableRowsParams): Promise<DataTableRow[]> {
  return agentClient.request<DataTableRow[]>("dataTables.insertRows", params);
}

export function updateDataTableRow(params: UpdateDataTableRowParams): Promise<DataTableRow> {
  return agentClient.request<DataTableRow>("dataTables.updateRow", params);
}

export function deleteDataTableRows(params: DeleteDataTableRowsParams): Promise<{ deleted: number }> {
  return agentClient.request<{ deleted: number }>("dataTables.deleteRows", params);
}

export function addDataTableColumn(params: AddDataTableColumnParams): Promise<DataTable> {
  return agentClient.request<DataTable>("dataTables.addColumn", params);
}

export function renameDataTableColumn(params: RenameDataTableColumnParams): Promise<DataTable> {
  return agentClient.request<DataTable>("dataTables.renameColumn", params);
}

export function removeDataTableColumn(params: RemoveDataTableColumnParams): Promise<DataTable> {
  return agentClient.request<DataTable>("dataTables.removeColumn", params);
}

export function updateDataTableColumnConfig(params: UpdateDataTableColumnConfigParams): Promise<DataTable> {
  return agentClient.request<DataTable>("dataTables.updateColumnConfig", params);
}

export function countDataTables(projectId: string): Promise<{ count: number }> {
  return agentClient.request<{ count: number }>("dataTables.count", { projectId });
}

export function countAllDataTables(): Promise<{ count: number }> {
  return agentClient.request<{ count: number }>("dataTables.countAll");
}

// ─── Targets ───

export function listTargets(params: ListTargetsParams): Promise<Target[]> {
  return agentClient.request<Target[]>("targets.list", params);
}

export function createTarget(params: CreateTargetParams): Promise<Target> {
  return agentClient.request<Target>("targets.create", params);
}

export function updateTarget(params: UpdateTargetParams): Promise<Target> {
  return agentClient.request<Target>("targets.update", params);
}

export function deleteTarget(id: string): Promise<{ deleted: boolean }> {
  return agentClient.request<{ deleted: boolean }>("targets.delete", { id });
}

export function evaluateTargets(params: { goalId?: string; jobId?: string }): Promise<TargetEvaluation[]> {
  return agentClient.request<TargetEvaluation[]>("targets.evaluateAll", params);
}

// ─── Visualizations ───

export function listVisualizations(params: ListVisualizationsParams): Promise<Visualization[]> {
  return agentClient.request<Visualization[]>("visualizations.list", params);
}

export function listAllVisualizations(): Promise<Visualization[]> {
  return agentClient.request<Visualization[]>("visualizations.listAll");
}

export function createVisualization(params: CreateVisualizationParams): Promise<Visualization> {
  return agentClient.request<Visualization>("visualizations.create", params);
}

export function updateVisualization(params: UpdateVisualizationParams): Promise<Visualization> {
  return agentClient.request<Visualization>("visualizations.update", params);
}

export function deleteVisualization(id: string): Promise<{ deleted: boolean }> {
  return agentClient.request<{ deleted: boolean }>("visualizations.delete", { id });
}

export function acceptVisualization(id: string): Promise<Visualization> {
  return agentClient.request<Visualization>("visualizations.accept", { id });
}

export function dismissVisualization(id: string): Promise<Visualization> {
  return agentClient.request<Visualization>("visualizations.dismiss", { id });
}

// ─── Claude Code Usage ───

export function getUsageSummary(): Promise<UsageSummary> {
  return agentClient.request<UsageSummary>("usage.getSummary");
}

// ─── Autopilot Scanner ───

export function getAutopilotStatus(): Promise<{ intervalMinutes: number }> {
  return agentClient.request("autopilot.getStatus");
}

export function forceAutopilotScan(): Promise<{ success: boolean }> {
  return agentClient.request("autopilot.forceScan");
}

// ─── Inbox ───

export function listInboxEvents(params?: ListInboxEventsParams): Promise<InboxEvent[]> {
  return agentClient.request<InboxEvent[]>("inbox.list", params);
}

export function resolveInboxEvent(params: ResolveInboxEventParams): Promise<InboxEvent> {
  return agentClient.request<InboxEvent>("inbox.resolve", params);
}

export function sendInboxMessage(params: SendInboxMessageParams): Promise<{ started: boolean; conversationId: string }> {
  return agentClient.request("inbox.sendMessage", params);
}

export function countInboxEvents(params?: { projectId?: string; status?: string }): Promise<{ count: number }> {
  return agentClient.request<{ count: number }>("inbox.count", params);
}

export function getInboxTierBoundaries(params: GetInboxTiersParams): Promise<InboxTierBoundaries> {
  return agentClient.request("inbox.getTierBoundaries", params);
}

export function listFutureInboxEvents(params?: ListFutureInboxEventsParams): Promise<InboxEvent[]> {
  return agentClient.request<InboxEvent[]>("inbox.listFuture", params);
}

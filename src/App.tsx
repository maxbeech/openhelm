import { useEffect, useState, useCallback, useRef } from "react";
import logoSvg from "./assets/logo.svg";
import { RefreshCw } from "lucide-react";
import { agentClient } from "./lib/agent-client";
import * as api from "./lib/api";
import { friendlyError } from "./lib/utils";
import { initFrontendSentry, setAnalyticsEnabled } from "./lib/sentry";
import { initPostHog, setRecordingEnabled, captureEvent } from "./lib/posthog";
import { AppErrorBoundary } from "./components/shared/error-boundary";

// Initialize Sentry and PostHog before first render — both are idempotent
initFrontendSentry();
initPostHog();
import { useAppStore } from "./stores/app-store";
import { useProjectStore } from "./stores/project-store";
import { useGoalStore } from "./stores/goal-store";
import { useJobStore } from "./stores/job-store";
import { useRunStore } from "./stores/run-store";
import { useDashboardStore } from "./stores/dashboard-store";
import { useMemoryStore } from "./stores/memory-store";
import { useChatStore } from "./stores/chat-store";
import { useUpdaterStore } from "./stores/updater-store";
import { useCredentialStore } from "./stores/credential-store";
import { useDataTableStore } from "./stores/data-table-store";
import { useVisualizationStore } from "./stores/visualization-store";
import { useAgentEvent } from "./hooks/use-agent-event";
import type { RunStatus, ChatMessage, DashboardItem, Memory, Credential, DataTable, Visualization } from "@openhelm/shared";
import {
  notifyDashboardItem,
  notifyRunCompleted,
  notifyAutopilotFailed,
  notifyChatResponse,
} from "./lib/notifications";
import { OnboardingWizard } from "./components/onboarding/onboarding-wizard";
import { AppShell } from "./components/layout/app-shell";
import { WelcomeView } from "./components/content/welcome-view";
import { GoalDetailView } from "./components/content/goal-detail-view";
import { JobDetailView } from "./components/content/job-detail-view";
import { RunDetailView } from "./components/content/run-detail-view";
import { SettingsScreen } from "./components/settings/settings-screen";
import { DashboardView } from "./components/content/dashboard-view";
import { MemoryView } from "./components/memory/memory-view";
import { CredentialView } from "./components/credentials/credential-view";
import { DataTableView } from "./components/data-tables/data-table-view";
import { JobCreationSheet } from "./components/jobs/job-creation-sheet";
import { TooltipProvider } from "./components/ui/tooltip";
import { NewProjectDialog } from "./components/shared/new-project-dialog";
import { EditProjectDialog } from "./components/shared/edit-project-dialog";

const SAILING_PHRASES = [
  "Pulling through the fairlead\u2026",
  "Stocking the ship\u2019s biscuits\u2026",
  "Hoisting the mainsail\u2026",
  "Charting the course\u2026",
  "Checking the rigging\u2026",
  "Raising the anchor\u2026",
  "Unfurling the jib\u2026",
  "Tying the bowline\u2026",
  "Setting the compass heading\u2026",
  "Swabbing the quarterdeck\u2026",
  "Loading the cargo hold\u2026",
  "Trimming the sails\u2026",
  "Winding the capstan\u2026",
  "Reading the almanac\u2026",
  "Polishing the binnacle\u2026",
];

function useRotatingPhrase(phrases: string[], intervalMs = 2500): string {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * phrases.length));
  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % phrases.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [phrases.length, intervalMs]);
  return phrases[index];
}

export default function App() {
  const { setShouldCheckUpdates } = useUpdaterStore();
  const {
    contentView,
    selectedGoalId,
    selectedJobId,
    selectedRunId,
    activeProjectId,
    onboardingComplete,
    agentReady,
    setActiveProjectId,
    setOnboardingComplete,
    setAgentReady,
    setContentView,
    setProjectGroupOrder,
  } = useAppStore();
  const { projects, fetchProjects } = useProjectStore();
  const { goals, fetchGoals } = useGoalStore();
  const { fetchJobs, updateJobInStore } = useJobStore();
  const { fetchRuns, updateRunInStore } = useRunStore();
  const {
    messages: chatMessages,
    fetchConversations,
    addMessageToStore,
    updateMessageInStore,
    setConvSending,
    setConvStatus,
    appendConvStreaming,
    clearConvStreaming,
  } = useChatStore();
  // Must be at top level — cannot be called after early returns
  const activeConvId = useChatStore((s) => s.activeConversationId);
  const chatSending = useChatStore((s) => {
    const convId = s.activeConversationId;
    return convId ? (s.conversationStates[convId]?.sending ?? false) : false;
  });
  const {
    fetchItems: fetchDashboardItems,
    fetchOpenCount: fetchDashboardCount,
    addItemToStore: addDashboardItem,
    updateItemInStore: updateDashboardItem,
  } = useDashboardStore();
  const {
    fetchMemories,
    fetchCount: fetchMemoryCount,
    addMemoryToStore,
    updateMemoryInStore,
    removeMemoryFromStore,
  } = useMemoryStore();

  const {
    fetchCount: fetchCredentialCount,
    addCredentialToStore,
    updateCredentialInStore,
    removeCredentialFromStore,
  } = useCredentialStore();

  const {
    fetchCount: fetchDataTableCount,
    addTableToStore,
    updateTableInStore,
    removeTableFromStore,
    refreshRowsForTable,
  } = useDataTableStore();

  const [showNewProject, setShowNewProject] = useState(false);
  const [editProjectId, setEditProjectId] = useState<string | null>(null);
  const [showJobSheet, setShowJobSheet] = useState(false);
  const [jobSheetInitialName, setJobSheetInitialName] = useState("");
  const [jobSheetInitialGoalId, setJobSheetInitialGoalId] = useState<
    string | undefined
  >(undefined);
  // Project to use for job creation — derived from goal when in All Projects mode
  const [jobSheetProjectId, setJobSheetProjectId] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [agentTimeout, setAgentTimeout] = useState(false);

  const sailingPhrase = useRotatingPhrase(SAILING_PHRASES);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  // Track which run IDs we've already notified to prevent duplicate notifications.
  // The agent can emit run.statusChanged multiple times for the same run (e.g. once
  // when the executor finishes and once after memory extraction updates the run).
  const notifiedRunIds = useRef<Set<string>>(new Set());

  // Global run event handlers
  const handleRunCreated = useCallback(() => {
    fetchRuns(activeProjectId);
  }, [activeProjectId, fetchRuns]);

  const handleRunStatusChanged = useCallback(
    (data: {
      runId: string;
      status: RunStatus;
      summary?: string | null;
      startedAt?: string;
      finishedAt?: string;
      exitCode?: number | null;
      sessionId?: string | null;
    }) => {
      updateRunInStore({
        id: data.runId,
        status: data.status,
        ...(data.summary != null && { summary: data.summary }),
        ...(data.startedAt != null && { startedAt: data.startedAt }),
        ...(data.finishedAt != null && { finishedAt: data.finishedAt }),
        ...(data.exitCode !== undefined && { exitCode: data.exitCode }),
        ...(data.sessionId != null && { sessionId: data.sessionId }),
      });

      // Send run-completion notification for terminal statuses
      const terminalStatuses: RunStatus[] = [
        "succeeded",
        "failed",
        "permanent_failure",
      ];
      if (terminalStatuses.includes(data.status) && !notifiedRunIds.current.has(data.runId)) {
        notifiedRunIds.current.add(data.runId);
        const run = useRunStore
          .getState()
          .runs.find((r) => r.id === data.runId);
        if (run) {
          const job = useJobStore
            .getState()
            .jobs.find((j) => j.id === run.jobId);
          notifyRunCompleted(
            data.status,
            job?.name ?? "Unknown job",
            data.summary,
          );
        }
        captureEvent("run_completed", { status: data.status });
      }
    },
    [updateRunInStore],
  );

  useAgentEvent("run.created", handleRunCreated);
  useAgentEvent("run.statusChanged", handleRunStatusChanged);

  // Icon update event handlers (background AI icon picks)
  const handleGoalIconUpdated = useCallback(
    (data: { id: string; icon: string }) => {
      const { goals } = useGoalStore.getState();
      const goal = goals.find((g) => g.id === data.id);
      if (goal) {
        useGoalStore.setState({
          goals: goals.map((g) =>
            g.id === data.id ? { ...g, icon: data.icon } : g,
          ),
        });
      }
    },
    [],
  );

  const handleJobIconUpdated = useCallback(
    (data: { id: string; icon: string }) => {
      const { jobs } = useJobStore.getState();
      const job = jobs.find((j) => j.id === data.id);
      if (job) {
        updateJobInStore({ ...job, icon: data.icon });
      }
    },
    [updateJobInStore],
  );

  // Job updated event (e.g. correction context changes)
  const handleJobUpdated = useCallback(
    (_data: { jobId: string }) => {
      fetchJobs(activeProjectId);
    },
    [activeProjectId, fetchJobs],
  );

  useAgentEvent("goal.iconUpdated", handleGoalIconUpdated);
  useAgentEvent("job.iconUpdated", handleJobIconUpdated);
  useAgentEvent("job.updated", handleJobUpdated);

  // Chat event handlers — filter by conversationId so cross-thread events are isolated.
  // This enables simultaneous conversations across different threads.
  const handleChatMessageCreated = useCallback(
    (data: ChatMessage & { projectId?: string | null; conversationId?: string }) => {
      const activeConvId = useChatStore.getState().activeConversationId;
      const eventConvId = data.conversationId;
      // Only update message list when viewing the same conversation
      if (eventConvId && eventConvId === activeConvId) {
        if (data.role === "user") {
          // Replace any optimistic placeholder for this conversation with the persisted message.
          useChatStore.setState((s) => {
            const withoutOptimistic = s.messages.filter(
              (m) => !m.id.startsWith(`pending-${eventConvId}-`),
            );
            if (withoutOptimistic.some((m) => m.id === data.id)) return { messages: withoutOptimistic };
            return { messages: [...withoutOptimistic, data] };
          });
        } else {
          const existing = useChatStore.getState().messages.find((m) => m.id === data.id);
          if (existing) {
            updateMessageInStore(data);
          } else {
            addMessageToStore(data);
          }
        }
      }
      // Clear per-conversation transient state regardless of which thread is active
      if (data.role === "assistant" && eventConvId) {
        clearConvStreaming(eventConvId);
        setConvSending(eventConvId, false);
        // Send notification if window is not focused
        const conv = useChatStore.getState().conversations.find((c) => c.id === eventConvId);
        notifyChatResponse(conv?.title ?? null, data.content?.slice(0, 150));
      }
    },
    [addMessageToStore, updateMessageInStore, clearConvStreaming, setConvSending],
  );

  const handleChatStatus = useCallback(
    (data: { status: string; tools?: string[]; projectId?: string | null; conversationId?: string }) => {
      const convId = data.conversationId;
      if (!convId) return;
      if (data.status === "done") {
        setConvStatus(convId, null);
        return;
      }
      clearConvStreaming(convId);
      if (data.status === "reading" && data.tools) {
        const friendlyNames: Record<string, string> = {
          list_goals: "goals",
          list_jobs: "jobs",
          list_runs: "runs",
          get_goal: "goal details",
          get_job: "job details",
          get_run_logs: "run logs",
          list_data_tables: "data tables",
          get_data_table: "table schema",
          get_data_table_rows: "table data",
          list_memories: "memories",
        };
        const label = data.tools
          .map((t) => friendlyNames[t] ?? t.replace(/_/g, " "))
          .join(", ");
        setConvStatus(convId, `Looking up ${label}...`);
      } else if (data.status === "analyzing") {
        setConvStatus(convId, "Analyzing results...");
      } else {
        setConvStatus(convId, "Thinking...");
      }
    },
    [clearConvStreaming, setConvStatus],
  );

  const handleChatStreaming = useCallback(
    (data: { text: string; projectId?: string | null; conversationId?: string }) => {
      if (data.conversationId) appendConvStreaming(data.conversationId, data.text);
    },
    [appendConvStreaming],
  );

  const handleChatActionResolved = useCallback(
    (data: { projectId?: string | null; conversationId?: string }) => {
      const currentProject = useAppStore.getState().activeProjectId;
      if ((data.projectId ?? null) !== currentProject) return;
      fetchGoals(activeProjectId);
      fetchJobs(activeProjectId);
      fetchRuns(activeProjectId);
    },
    [activeProjectId, fetchGoals, fetchJobs, fetchRuns],
  );

  const handleChatError = useCallback(
    (data: { projectId?: string | null; conversationId?: string; error: string }) => {
      const convId = data.conversationId;
      // Always clear per-conversation sending/status so UI never gets stuck
      if (convId) {
        setConvSending(convId, false);
        setConvStatus(convId, null);
        clearConvStreaming(convId);
      }
      // Only show error banner when viewing the same conversation
      const activeConvId = useChatStore.getState().activeConversationId;
      if (convId && convId === activeConvId) {
        useChatStore.setState({ error: friendlyError(new Error(data.error), "Chat failed") });
      }
    },
    [setConvSending, setConvStatus, clearConvStreaming],
  );

  const handleChatThreadRenamed = useCallback(
    (data: { conversationId: string; title: string }) => {
      useChatStore.setState((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === data.conversationId ? { ...c, title: data.title } : c,
        ),
      }));
    },
    [],
  );

  useAgentEvent("chat.messageCreated", handleChatMessageCreated);
  useAgentEvent("chat.status", handleChatStatus);
  useAgentEvent("chat.streaming", handleChatStreaming);
  useAgentEvent("chat.error", handleChatError);
  useAgentEvent("chat.actionResolved", handleChatActionResolved);
  useAgentEvent("chat.threadRenamed", handleChatThreadRenamed);

  // Dashboard event handlers — respect active project filter
  const handleDashboardCreated = useCallback(
    (item: DashboardItem) => {
      // Only add to store if it matches the current project filter
      if (!activeProjectId || item.projectId === activeProjectId) {
        addDashboardItem(item);
      }
      notifyDashboardItem(item);
    },
    [activeProjectId, addDashboardItem],
  );

  const handleDashboardResolved = useCallback(
    (item: DashboardItem) => {
      updateDashboardItem(item);
    },
    [updateDashboardItem],
  );

  useAgentEvent("dashboard.created", handleDashboardCreated);
  useAgentEvent("dashboard.resolved", handleDashboardResolved);

  // Autopilot failure handler
  const handleAutopilotFailed = useCallback(
    (data: { goalId: string; projectId: string; goalName: string; error: string; hint?: string }) => {
      notifyAutopilotFailed(data.goalName, data.error, data.hint);
    },
    [],
  );
  useAgentEvent("autopilot.generationFailed", handleAutopilotFailed);

  // Memory event handlers
  const handleMemoryCreated = useCallback(
    (memory: Memory) => {
      addMemoryToStore(memory);
    },
    [addMemoryToStore],
  );
  const handleMemoryUpdated = useCallback(
    (memory: Memory) => {
      updateMemoryInStore(memory);
    },
    [updateMemoryInStore],
  );
  const handleMemoryDeleted = useCallback(
    (data: { id: string }) => {
      removeMemoryFromStore(data.id);
    },
    [removeMemoryFromStore],
  );

  useAgentEvent("memory.created", handleMemoryCreated);
  useAgentEvent("memory.updated", handleMemoryUpdated);
  useAgentEvent("memory.deleted", handleMemoryDeleted);

  // Credential event handlers
  const handleCredentialCreated = useCallback(
    (credential: Credential) => {
      addCredentialToStore(credential);
    },
    [addCredentialToStore],
  );
  const handleCredentialUpdated = useCallback(
    (credential: Credential) => {
      updateCredentialInStore(credential);
    },
    [updateCredentialInStore],
  );
  const handleCredentialDeleted = useCallback(
    (data: { id: string }) => {
      removeCredentialFromStore(data.id);
    },
    [removeCredentialFromStore],
  );

  useAgentEvent("credential.created", handleCredentialCreated);
  useAgentEvent("credential.updated", handleCredentialUpdated);
  useAgentEvent("credential.deleted", handleCredentialDeleted);

  // Data table event handlers
  const handleDataTableCreated = useCallback(
    (table: DataTable) => { addTableToStore(table); },
    [addTableToStore],
  );
  const handleDataTableUpdated = useCallback(
    (table: DataTable) => { updateTableInStore(table); },
    [updateTableInStore],
  );
  const handleDataTableDeleted = useCallback(
    (data: { id: string }) => { removeTableFromStore(data.id); },
    [removeTableFromStore],
  );
  const handleDataTableRowsChanged = useCallback(
    (data: { tableId: string }) => { refreshRowsForTable(data.tableId); },
    [refreshRowsForTable],
  );

  useAgentEvent("dataTable.created", handleDataTableCreated);
  useAgentEvent("dataTable.updated", handleDataTableUpdated);
  useAgentEvent("dataTable.deleted", handleDataTableDeleted);
  useAgentEvent("dataTable.rowsChanged", handleDataTableRowsChanged);

  // Visualization event handlers
  const {
    addToStore: addVizToStore,
    updateInStore: updateVizInStore,
    removeFromStore: removeVizFromStore,
  } = useVisualizationStore();

  const handleVizCreated = useCallback(
    (viz: Visualization) => { addVizToStore(viz); },
    [addVizToStore],
  );
  const handleVizUpdated = useCallback(
    (viz: Visualization) => { updateVizInStore(viz); },
    [updateVizInStore],
  );
  const handleVizDeleted = useCallback(
    (data: { id: string }) => { removeVizFromStore(data.id); },
    [removeVizFromStore],
  );

  useAgentEvent("visualization.created", handleVizCreated);
  useAgentEvent("visualization.updated", handleVizUpdated);
  useAgentEvent("visualization.deleted", handleVizDeleted);
  useAgentEvent("visualization.suggested", handleVizCreated);

  // Start agent client
  useEffect(() => {
    const onReady = () => {
      setAgentReady(true);
      setAgentTimeout(false); // Reset timeout flag on reconnect (sidecar auto-restarted)
    };
    const onTerminated = () => {
      console.error("Agent sidecar terminated unexpectedly");
      setAgentReady(false);
      setAgentTimeout(true);
    };
    window.addEventListener("agent:agent.ready", onReady);
    window.addEventListener("agent:agent.terminated", onTerminated);
    agentClient.start().catch((err) => {
      console.error("Failed to start agent client:", err);
    });
    return () => {
      window.removeEventListener("agent:agent.ready", onReady);
      window.removeEventListener("agent:agent.terminated", onTerminated);
    };
  }, [setAgentReady]);

  // Timeout
  useEffect(() => {
    if (agentReady) return;
    const timer = setTimeout(() => setAgentTimeout(true), 15_000);
    return () => clearTimeout(timer);
  }, [agentReady]);

  // Load initial state
  useEffect(() => {
    if (!agentReady) return;
    (async () => {
      try {
        // Check the persisted onboarding flag first — this survives updates
        // even if projects can't be loaded momentarily
        const onboardingFlag = await api.getSetting("onboarding_complete").catch(() => null);
        await fetchProjects();
        const projectsList = useProjectStore.getState().projects;
        if (projectsList.length > 0 || onboardingFlag?.value === "true") {
          setOnboardingComplete(true);
          // Backfill flag for existing users who completed onboarding before this flag existed
          if (onboardingFlag?.value !== "true") {
            api.setSetting({ key: "onboarding_complete", value: "true" }).catch(() => {});
          }
          const saved = await api.getSetting("active_project");
          const savedId = saved?.value;
          const activeProj = projectsList.find((p) => p.id === savedId);
          // Use saved project, or if only one project exists default to it
          // instead of "All Projects"
          setActiveProjectId(
            activeProj?.id ?? (projectsList.length === 1 ? projectsList[0].id : null),
          );
          const savedGroupOrder = await api.getSetting("sidebar_project_group_order").catch(() => null);
          if (savedGroupOrder?.value) {
            try { setProjectGroupOrder(JSON.parse(savedGroupOrder.value)); } catch { /* ignore */ }
          }
        }
        // Fetch cross-project dashboard right away
        fetchDashboardItems();
        fetchDashboardCount();
        // Configure Sentry opt-out and PostHog session recording (read after projects load)
        try {
          const s = await api.getSetting("analytics_enabled");
          const enabled = s?.value !== "false";
          setAnalyticsEnabled(enabled);
          setRecordingEnabled(enabled);
        } catch {
          // Keep optimistic defaults (enabled)
        }
        captureEvent("app_opened");
        // Enable auto-update check unless user has explicitly opted out or running in dev mode
        if (!import.meta.env.DEV) {
          try {
            const autoUpdate = await api.getSetting("auto_update_enabled");
            if (autoUpdate?.value !== "false") {
              setShouldCheckUpdates(true);
            }
          } catch {
            // Default ON
            setShouldCheckUpdates(true);
          }
        }
      } catch (err) {
        console.error("Initial load failed:", err);
      } finally {
        setInitialLoading(false);
      }
    })();
  }, [agentReady, fetchProjects, setOnboardingComplete, setActiveProjectId, setProjectGroupOrder, fetchDashboardItems, fetchDashboardCount, setShouldCheckUpdates]);

  // Fetch data when project filter changes (null = All Projects)
  useEffect(() => {
    // Clear transient chat state from previous project
    useChatStore.setState({ error: null });

    fetchGoals(activeProjectId);
    fetchJobs(activeProjectId);
    fetchRuns(activeProjectId);
    fetchMemories(activeProjectId);
    fetchMemoryCount(activeProjectId);
    fetchCredentialCount(activeProjectId);
    fetchDataTableCount(activeProjectId);
    fetchDashboardItems(activeProjectId ?? undefined);
    fetchDashboardCount(activeProjectId ?? undefined);
    // Fetch conversations (threads) for this project — also loads messages for the active thread
    fetchConversations(activeProjectId);
    if (activeProjectId) {
      api
        .setSetting({ key: "active_project", value: activeProjectId })
        .catch(() => {});
    }
  }, [activeProjectId, fetchGoals, fetchJobs, fetchRuns, fetchConversations, fetchMemories, fetchMemoryCount, fetchCredentialCount, fetchDataTableCount, fetchDashboardItems, fetchDashboardCount]);

  // Notification permission is now requested during onboarding (Permissions step)
  // and can be re-requested via Settings > Permissions. No startup prompt needed.

  // Track view navigation
  useEffect(() => {
    if (agentReady && onboardingComplete) {
      captureEvent("view_changed", { view: contentView });
    }
  }, [contentView, agentReady, onboardingComplete]);

  const handleOnboardingComplete = useCallback(
    (projectId: string) => {
      fetchProjects().then(async () => {
        // Persist both the active project and onboarding flag so re-launches
        // (including after updates) skip onboarding.
        await Promise.all([
          api.setSetting({ key: "active_project", value: projectId }).catch(() => {}),
          api.setSetting({ key: "onboarding_complete", value: "true" }).catch(() => {}),
        ]);
        captureEvent("onboarding_completed");
        setActiveProjectId(projectId);
        setOnboardingComplete(true);
      });
    },
    [fetchProjects, setActiveProjectId, setOnboardingComplete],
  );

  const handleNewProject = useCallback(
    (projectId: string) => {
      fetchProjects().then(() => {
        setActiveProjectId(projectId);
        setShowNewProject(false);
      });
    },
    [fetchProjects, setActiveProjectId],
  );

  const handleEditProject = useCallback((projectId: string) => {
    setEditProjectId(projectId);
  }, []);

  const handleProjectSaved = useCallback(() => {
    setEditProjectId(null);
  }, []);

  const handleProjectDeleted = useCallback(
    (projectId: string) => {
      setEditProjectId(null);
      if (activeProjectId === projectId) {
        setActiveProjectId(null);
      }
    },
    [activeProjectId, setActiveProjectId],
  );

  const handleNewJobForGoal = useCallback(
    (goalId: string, initialName: string) => {
      const { goals: allGoals } = useGoalStore.getState();
      const goal = allGoals.find((g) => g.id === goalId);
      setJobSheetInitialName(initialName);
      setJobSheetInitialGoalId(goalId);
      setJobSheetProjectId(goal?.projectId ?? activeProjectId);
      setShowJobSheet(true);
    },
    [activeProjectId],
  );

  // Loading state
  if (!agentReady || initialLoading) {
    return (
      <div
        data-tauri-drag-region
        className="no-select flex min-h-screen flex-col items-center justify-center gap-4 bg-background"
      >
        <div data-tauri-drag-region className="flex items-center gap-2">
          <img src={logoSvg} alt="OpenHelm" className="size-10" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            OpenHelm
          </h1>
        </div>
        {agentTimeout ? (
          <div className="flex flex-col items-center gap-3">
            <p className="max-w-xs text-center text-sm text-destructive">
              The background agent is not responding. Check that Claude Code is
              installed and try restarting.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <RefreshCw className="size-4" />
              Restart
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="size-2 animate-pulse rounded-full bg-primary" />
            {sailingPhrase}
          </div>
        )}
      </div>
    );
  }

  // Onboarding
  if (!onboardingComplete) {
    return (
      <TooltipProvider>
        <OnboardingWizard onComplete={handleOnboardingComplete} />
      </TooltipProvider>
    );
  }

  const hasGoals = goals.length > 0;
  // Show welcome only when on dashboard view, no goals, no chat activity, and a specific project is selected
  const showWelcome =
    contentView === "dashboard" &&
    !hasGoals &&
    chatMessages.length === 0 &&
    !chatSending &&
    !!activeProjectId;

  // Main app
  return (
    <AppErrorBoundary>
    <TooltipProvider>
      <AppShell
        onNewProject={() => setShowNewProject(true)}
        onEditProject={handleEditProject}
        onNewJobForGoal={handleNewJobForGoal}
        rightPanel={
          selectedRunId ? <RunDetailView runId={selectedRunId} /> : undefined
        }
      >
        {contentView === "dashboard" &&
          (showWelcome ? (
            <WelcomeView projectId={activeProjectId!} />
          ) : (
            <DashboardView />
          ))}
        {contentView === "home" && <DashboardView />}
        {contentView === "goal-detail" && selectedGoalId && (
          <GoalDetailView
            goalId={selectedGoalId}
            onNewJob={() => {
              const { goals: allGoals } = useGoalStore.getState();
              const goal = allGoals.find((g) => g.id === selectedGoalId);
              setJobSheetInitialName("");
              setJobSheetInitialGoalId(selectedGoalId);
              setJobSheetProjectId(goal?.projectId ?? activeProjectId);
              setShowJobSheet(true);
            }}
          />
        )}
        {contentView === "job-detail" && selectedJobId && (
          <JobDetailView jobId={selectedJobId} />
        )}
        {contentView === "memory" && <MemoryView />}
        {(contentView === "data-tables" || contentView === "data-table-detail") && <DataTableView />}
        {contentView === "credentials" && <CredentialView />}
        {contentView === "settings" && <SettingsScreen />}
      </AppShell>

      <NewProjectDialog
        open={showNewProject}
        onOpenChange={setShowNewProject}
        onCreated={handleNewProject}
      />

      {editProjectId && (() => {
        const editProject = projects.find((p) => p.id === editProjectId);
        return editProject ? (
          <EditProjectDialog
            open={true}
            onOpenChange={(open) => { if (!open) setEditProjectId(null); }}
            project={editProject}
            onSaved={handleProjectSaved}
            onDeleted={handleProjectDeleted}
          />
        ) : null;
      })()}

      {/* Job Creation Sheet — use jobSheetProjectId so it works in All Projects mode */}
      {(() => {
        const sheetProject = jobSheetProjectId
          ? projects.find((p) => p.id === jobSheetProjectId)
          : activeProject;
        const sheetProjectId = jobSheetProjectId ?? activeProjectId;
        if (!sheetProject || !sheetProjectId) return null;
        return (
          <JobCreationSheet
            open={showJobSheet}
            onOpenChange={setShowJobSheet}
            projectId={sheetProjectId}
            projectDirectory={sheetProject.directoryPath}
            initialName={jobSheetInitialName}
            initialGoalId={jobSheetInitialGoalId}
            onComplete={() => {
              fetchGoals(sheetProjectId);
              fetchJobs(sheetProjectId);
              // Also refresh the active project view if different
              if (activeProjectId && activeProjectId !== sheetProjectId) {
                fetchGoals(activeProjectId);
                fetchJobs(activeProjectId);
              }
            }}
          />
        );
      })()}
    </TooltipProvider>
    </AppErrorBoundary>
  );
}

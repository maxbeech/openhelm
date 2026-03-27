import { useEffect, useState, useCallback, useRef } from "react";
import logoSvg from "./assets/logo.svg";
import { RefreshCw } from "lucide-react";
import { agentClient } from "./lib/agent-client";
import * as api from "./lib/api";
import { friendlyError } from "./lib/utils";
import { initFrontendSentry, setAnalyticsEnabled } from "./lib/sentry";
import { AppErrorBoundary } from "./components/shared/error-boundary";

// Initialize Sentry before first render — idempotent, safe to call at module level
initFrontendSentry();
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
import { useAgentEvent } from "./hooks/use-agent-event";
import type { RunStatus, ChatMessage, DashboardItem, Memory, Credential } from "@openhelm/shared";
import {
  notifyDashboardItem,
  notifyRunCompleted,
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
  } = useAppStore();
  const { projects, fetchProjects } = useProjectStore();
  const { goals, fetchGoals } = useGoalStore();
  const { fetchJobs, updateJobInStore } = useJobStore();
  const { fetchRuns, updateRunInStore } = useRunStore();
  const {
    messages: chatMessages,
    sending: chatSending,
    fetchMessages,
    addMessageToStore,
    updateMessageInStore,
    appendStreamingText,
    clearStreamingText,
  } = useChatStore();
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

  // Chat event handlers — filter by projectId so cross-project events are ignored
  const handleChatMessageCreated = useCallback(
    (data: ChatMessage & { projectId?: string }) => {
      const currentProject = useAppStore.getState().activeProjectId;
      if (data.projectId && data.projectId !== currentProject) return;

      const existing = useChatStore
        .getState()
        .messages.find((m) => m.id === data.id);
      if (existing) {
        updateMessageInStore(data);
      } else {
        addMessageToStore(data);
      }
      // Assistant message arrived — clear streaming preview and sending state
      if (data.role === "assistant") {
        clearStreamingText();
        useChatStore.setState({ sending: false });
      }
    },
    [addMessageToStore, updateMessageInStore, clearStreamingText],
  );

  const handleChatStatus = useCallback(
    (data: { status: string; tools?: string[]; projectId?: string }) => {
      const currentProject = useAppStore.getState().activeProjectId;
      if (data.projectId && data.projectId !== currentProject) return;

      const { setStatusText } = useChatStore.getState();
      if (data.status === "done") {
        setStatusText(null);
        return;
      }
      // Clear streaming preview on each new LLM iteration so stale chunks don't linger
      clearStreamingText();
      if (data.status === "reading" && data.tools) {
        const label = data.tools
          .map((t) => t.replace(/_/g, " "))
          .join(", ");
        setStatusText(`Looking up ${label}...`);
      } else if (data.status === "analyzing") {
        setStatusText("Analyzing results...");
      } else {
        setStatusText("Thinking...");
      }
    },
    [clearStreamingText],
  );

  const handleChatStreaming = useCallback(
    (data: { text: string; projectId?: string }) => {
      const currentProject = useAppStore.getState().activeProjectId;
      if (data.projectId && data.projectId !== currentProject) return;
      appendStreamingText(data.text);
    },
    [appendStreamingText],
  );

  const handleChatActionResolved = useCallback(
    (data: { projectId?: string }) => {
      const currentProject = useAppStore.getState().activeProjectId;
      if (data.projectId && data.projectId !== currentProject) return;
      fetchGoals(activeProjectId);
      fetchJobs(activeProjectId);
      fetchRuns(activeProjectId);
    },
    [activeProjectId, fetchGoals, fetchJobs, fetchRuns],
  );

  const handleChatError = useCallback(
    (data: { projectId?: string; error: string }) => {
      const currentProject = useAppStore.getState().activeProjectId;
      if (data.projectId && data.projectId !== currentProject) return;
      useChatStore.setState({
        error: friendlyError(new Error(data.error), "Chat failed"),
        sending: false,
        statusText: null,
        streamingText: "",
      });
    },
    [],
  );

  useAgentEvent("chat.messageCreated", handleChatMessageCreated);
  useAgentEvent("chat.status", handleChatStatus);
  useAgentEvent("chat.streaming", handleChatStreaming);
  useAgentEvent("chat.error", handleChatError);
  useAgentEvent("chat.actionResolved", handleChatActionResolved);

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

  // Start agent client
  useEffect(() => {
    const onReady = () => setAgentReady(true);
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
        }
        // Fetch cross-project dashboard right away
        fetchDashboardItems();
        fetchDashboardCount();
        // Configure Sentry analytics opt-out (read after projects load)
        try {
          const s = await api.getSetting("analytics_enabled");
          setAnalyticsEnabled(s?.value !== "false");
        } catch {
          // Keep optimistic default (enabled)
        }
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
  }, [agentReady, fetchProjects, setOnboardingComplete, setActiveProjectId, fetchDashboardItems, fetchDashboardCount, setShouldCheckUpdates]);

  // Fetch data when project filter changes (null = All Projects)
  useEffect(() => {
    // Clear transient chat state from previous project so it doesn't leak
    useChatStore.getState().setStatusText(null);
    useChatStore.getState().clearStreamingText();

    fetchGoals(activeProjectId);
    fetchJobs(activeProjectId);
    fetchRuns(activeProjectId);
    fetchMemories(activeProjectId);
    fetchMemoryCount(activeProjectId);
    fetchCredentialCount(activeProjectId);
    fetchDashboardItems(activeProjectId ?? undefined);
    fetchDashboardCount(activeProjectId ?? undefined);
    if (activeProjectId) {
      fetchMessages(activeProjectId);
      api
        .setSetting({ key: "active_project", value: activeProjectId })
        .catch(() => {});
    }
  }, [activeProjectId, fetchGoals, fetchJobs, fetchRuns, fetchMessages, fetchMemories, fetchMemoryCount, fetchCredentialCount, fetchDashboardItems, fetchDashboardCount]);

  // Notification permission is now requested during onboarding (Permissions step)
  // and can be re-requested via Settings > Permissions. No startup prompt needed.

  const handleOnboardingComplete = useCallback(
    (projectId: string) => {
      fetchProjects().then(async () => {
        // Persist both the active project and onboarding flag so re-launches
        // (including after updates) skip onboarding.
        await Promise.all([
          api.setSetting({ key: "active_project", value: projectId }).catch(() => {}),
          api.setSetting({ key: "onboarding_complete", value: "true" }).catch(() => {}),
        ]);
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

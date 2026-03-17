import { useEffect, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { agentClient } from "./lib/agent-client";
import * as api from "./lib/api";
import { initFrontendSentry, setAnalyticsEnabled } from "./lib/sentry";
import { AppErrorBoundary } from "./components/shared/error-boundary";

// Initialize Sentry before first render — idempotent, safe to call at module level
initFrontendSentry();
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { useAppStore } from "./stores/app-store";
import { useProjectStore } from "./stores/project-store";
import { useGoalStore } from "./stores/goal-store";
import { useJobStore } from "./stores/job-store";
import { useRunStore } from "./stores/run-store";
import { useInboxStore } from "./stores/inbox-store";
import { useMemoryStore } from "./stores/memory-store";
import { useChatStore } from "./stores/chat-store";
import { useAgentEvent } from "./hooks/use-agent-event";
import type { RunStatus, ChatMessage, InboxItem, Memory } from "@openorchestra/shared";
import { notifyInboxItem } from "./lib/notifications";
import { OnboardingWizard } from "./components/onboarding/onboarding-wizard";
import { AppShell } from "./components/layout/app-shell";
import { WelcomeView } from "./components/content/welcome-view";
import { GoalDetailView } from "./components/content/goal-detail-view";
import { JobDetailView } from "./components/content/job-detail-view";
import { RunDetailView } from "./components/content/run-detail-view";
import { SettingsScreen } from "./components/settings/settings-screen";
import { InboxView } from "./components/content/inbox-view";
import { MemoryView } from "./components/memory/memory-view";
import { JobCreationSheet } from "./components/jobs/job-creation-sheet";
import { TooltipProvider } from "./components/ui/tooltip";
import { NewProjectDialog } from "./components/shared/new-project-dialog";
import { EditProjectDialog } from "./components/shared/edit-project-dialog";

export default function App() {
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
  } = useChatStore();
  const {
    fetchItems: fetchInboxItems,
    fetchOpenCount: fetchInboxCount,
    addItemToStore: addInboxItem,
    updateItemInStore: updateInboxItem,
  } = useInboxStore();
  const {
    fetchMemories,
    fetchCount: fetchMemoryCount,
    addMemoryToStore,
    updateMemoryInStore,
    removeMemoryFromStore,
  } = useMemoryStore();

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

  const activeProject = projects.find((p) => p.id === activeProjectId);

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

  // Chat event handlers
  const handleChatMessageCreated = useCallback(
    (msg: ChatMessage) => {
      const existing = useChatStore
        .getState()
        .messages.find((m) => m.id === msg.id);
      if (existing) {
        updateMessageInStore(msg);
      } else {
        addMessageToStore(msg);
      }
    },
    [addMessageToStore, updateMessageInStore],
  );

  const handleChatStatus = useCallback(
    (data: { status: string; tools?: string[] }) => {
      const { setStatusText } = useChatStore.getState();
      if (data.status === "done") {
        setStatusText(null);
        return;
      }
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
    [],
  );

  const handleChatActionResolved = useCallback(() => {
    fetchGoals(activeProjectId);
    fetchJobs(activeProjectId);
    fetchRuns(activeProjectId);
  }, [activeProjectId, fetchGoals, fetchJobs, fetchRuns]);

  useAgentEvent("chat.messageCreated", handleChatMessageCreated);
  useAgentEvent("chat.status", handleChatStatus);
  useAgentEvent("chat.actionResolved", handleChatActionResolved);

  // Inbox event handlers — respect active project filter
  const handleInboxCreated = useCallback(
    (item: InboxItem) => {
      // Only add to store if it matches the current project filter
      if (!activeProjectId || item.projectId === activeProjectId) {
        addInboxItem(item);
      }
      notifyInboxItem(item);
    },
    [activeProjectId, addInboxItem],
  );

  const handleInboxResolved = useCallback(
    (item: InboxItem) => {
      updateInboxItem(item);
    },
    [updateInboxItem],
  );

  useAgentEvent("inbox.created", handleInboxCreated);
  useAgentEvent("inbox.resolved", handleInboxResolved);

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

  // Start agent client
  useEffect(() => {
    const onReady = () => setAgentReady(true);
    window.addEventListener("agent:agent.ready", onReady);
    agentClient.start().catch((err) => {
      console.error("Failed to start agent client:", err);
    });
    return () => window.removeEventListener("agent:agent.ready", onReady);
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
      await fetchProjects();
      const projectsList = useProjectStore.getState().projects;
      if (projectsList.length > 0) {
        setOnboardingComplete(true);
        const saved = await api.getSetting("active_project");
        const savedId = saved?.value;
        const activeProj = projectsList.find((p) => p.id === savedId);
        // null = All Projects (default); specific project if previously saved
        setActiveProjectId(activeProj?.id ?? null);
      }
      // Fetch cross-project inbox right away
      fetchInboxItems();
      fetchInboxCount();
      // Configure Sentry analytics opt-out (read after projects load)
      try {
        const s = await api.getSetting("analytics_enabled");
        setAnalyticsEnabled(s?.value !== "false");
      } catch {
        // Keep optimistic default (enabled)
      }
      setInitialLoading(false);
    })();
  }, [agentReady, fetchProjects, setOnboardingComplete, setActiveProjectId, fetchInboxItems, fetchInboxCount]);

  // Fetch data when project filter changes (null = All Projects)
  useEffect(() => {
    fetchGoals(activeProjectId);
    fetchJobs(activeProjectId);
    fetchRuns(activeProjectId);
    fetchMemories(activeProjectId);
    fetchMemoryCount(activeProjectId);
    fetchInboxItems(activeProjectId ?? undefined);
    fetchInboxCount(activeProjectId ?? undefined);
    if (activeProjectId) {
      fetchMessages(activeProjectId);
      api
        .setSetting({ key: "active_project", value: activeProjectId })
        .catch(() => {});
    }
  }, [activeProjectId, fetchGoals, fetchJobs, fetchRuns, fetchMessages, fetchMemories, fetchMemoryCount, fetchInboxItems, fetchInboxCount]);

  // Notification permission
  useEffect(() => {
    if (!agentReady || initialLoading) return;
    (async () => {
      try {
        const notifRequested = await api.getSetting(
          "notification_permission_requested",
        );
        if (!notifRequested?.value) {
          const permissionGranted = await isPermissionGranted();
          if (!permissionGranted) await requestPermission();
          await api.setSetting({
            key: "notification_permission_requested",
            value: "true",
          });
        }
      } catch (err) {
        console.error("Failed to request notification permission:", err);
      }
    })();
  }, [agentReady, initialLoading]);

  const handleOnboardingComplete = useCallback(
    (projectId: string) => {
      fetchProjects().then(() => {
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
      <div className="no-select flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="text-primary">Open</span>Orchestra
        </h1>
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
            Starting agent...
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
  // Show welcome only when on inbox view, no goals, no chat activity, and a specific project is selected
  const showWelcome =
    contentView === "inbox" &&
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
        {contentView === "inbox" &&
          (showWelcome ? (
            <WelcomeView projectId={activeProjectId!} />
          ) : (
            <InboxView />
          ))}
        {contentView === "home" && <InboxView />}
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

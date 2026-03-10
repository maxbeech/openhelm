import { useEffect, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { agentClient } from "./lib/agent-client";
import * as api from "./lib/api";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { useAppStore } from "./stores/app-store";
import { useProjectStore } from "./stores/project-store";
import { useGoalStore } from "./stores/goal-store";
import { useJobStore } from "./stores/job-store";
import { useRunStore } from "./stores/run-store";
import { useChatStore } from "./stores/chat-store";
import { useAgentEvent } from "./hooks/use-agent-event";
import type { RunStatus, ChatMessage } from "@openorchestra/shared";
import { OnboardingWizard } from "./components/onboarding/onboarding-wizard";
import { AppShell } from "./components/layout/app-shell";
import { WelcomeView } from "./components/content/welcome-view";
import { HomeView } from "./components/content/home-view";
import { GoalDetailView } from "./components/content/goal-detail-view";
import { JobDetailView } from "./components/content/job-detail-view";
import { RunDetailView } from "./components/content/run-detail-view";
import { SettingsScreen } from "./components/settings/settings-screen";
import { JobCreationSheet } from "./components/jobs/job-creation-sheet";
import { TooltipProvider } from "./components/ui/tooltip";
import { NewProjectDialog } from "./components/shared/new-project-dialog";

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
  } = useAppStore();
  const { projects, fetchProjects } = useProjectStore();
  const { goals, fetchGoals } = useGoalStore();
  const { fetchJobs } = useJobStore();
  const { fetchRuns, updateRunInStore } = useRunStore();
  const {
    messages: chatMessages,
    sending: chatSending,
    fetchMessages,
    addMessageToStore,
    updateMessageInStore,
  } = useChatStore();

  const [showNewProject, setShowNewProject] = useState(false);
  const [showJobSheet, setShowJobSheet] = useState(false);
  const [jobSheetInitialName, setJobSheetInitialName] = useState("");
  const [jobSheetInitialGoalId, setJobSheetInitialGoalId] = useState<
    string | undefined
  >(undefined);
  const [initialLoading, setInitialLoading] = useState(true);
  const [agentTimeout, setAgentTimeout] = useState(false);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  // Global run event handlers
  const handleRunCreated = useCallback(() => {
    if (activeProjectId) fetchRuns(activeProjectId);
  }, [activeProjectId, fetchRuns]);

  const handleRunStatusChanged = useCallback(
    (data: {
      runId: string;
      status: RunStatus;
      summary?: string | null;
      startedAt?: string;
      finishedAt?: string;
      exitCode?: number | null;
    }) => {
      updateRunInStore({
        id: data.runId,
        status: data.status,
        ...(data.summary != null && { summary: data.summary }),
        ...(data.startedAt != null && { startedAt: data.startedAt }),
        ...(data.finishedAt != null && { finishedAt: data.finishedAt }),
        ...(data.exitCode !== undefined && { exitCode: data.exitCode }),
      });
    },
    [updateRunInStore],
  );

  useAgentEvent("run.created", handleRunCreated);
  useAgentEvent("run.statusChanged", handleRunStatusChanged);

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
    if (activeProjectId) {
      fetchGoals(activeProjectId);
      fetchJobs(activeProjectId);
      fetchRuns(activeProjectId);
    }
  }, [activeProjectId, fetchGoals, fetchJobs, fetchRuns]);

  useAgentEvent("chat.messageCreated", handleChatMessageCreated);
  useAgentEvent("chat.status", handleChatStatus);
  useAgentEvent("chat.actionResolved", handleChatActionResolved);

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
        const activeProj =
          projectsList.find((p) => p.id === savedId) ?? projectsList[0];
        setActiveProjectId(activeProj.id);
      }
      setInitialLoading(false);
    })();
  }, [agentReady, fetchProjects, setOnboardingComplete, setActiveProjectId]);

  // Centralized data fetching when project changes
  useEffect(() => {
    if (!activeProjectId) return;
    fetchGoals(activeProjectId);
    fetchJobs(activeProjectId);
    fetchRuns(activeProjectId);
    fetchMessages(activeProjectId);
    api
      .setSetting({ key: "active_project", value: activeProjectId })
      .catch(() => {});
  }, [activeProjectId, fetchGoals, fetchJobs, fetchRuns, fetchMessages]);

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

  const handleNewJobForGoal = useCallback(
    (goalId: string, initialName: string) => {
      setJobSheetInitialName(initialName);
      setJobSheetInitialGoalId(goalId);
      setShowJobSheet(true);
    },
    [],
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
  // Hide welcome screen once the user has sent a message (or is sending one)
  const showWelcome = !hasGoals && chatMessages.length === 0 && !chatSending;

  // Main app
  return (
    <TooltipProvider>
      <AppShell
        onNewProject={() => setShowNewProject(true)}
        onNewJobForGoal={handleNewJobForGoal}
      >
        {contentView === "home" &&
          (showWelcome && activeProjectId ? (
            <WelcomeView projectId={activeProjectId} />
          ) : (
            <HomeView />
          ))}
        {contentView === "goal-detail" && selectedGoalId && (
          <GoalDetailView
            goalId={selectedGoalId}
            onNewJob={() => {
              setJobSheetInitialName("");
              setJobSheetInitialGoalId(selectedGoalId);
              setShowJobSheet(true);
            }}
          />
        )}
        {contentView === "job-detail" && selectedJobId && (
          <JobDetailView jobId={selectedJobId} />
        )}
        {contentView === "run-detail" && selectedRunId && (
          <RunDetailView runId={selectedRunId} />
        )}
        {contentView === "settings" && <SettingsScreen />}
      </AppShell>

      <NewProjectDialog
        open={showNewProject}
        onOpenChange={setShowNewProject}
        onCreated={handleNewProject}
      />

      {/* Job Creation Sheet */}
      {activeProject && activeProjectId && (
        <JobCreationSheet
          open={showJobSheet}
          onOpenChange={setShowJobSheet}
          projectId={activeProjectId}
          projectDirectory={activeProject.directoryPath}
          initialName={jobSheetInitialName}
          initialGoalId={jobSheetInitialGoalId}
          onComplete={() => {
            fetchGoals(activeProjectId);
            fetchJobs(activeProjectId);
          }}
        />
      )}
    </TooltipProvider>
  );
}

import { useEffect } from "react";
import { AlertTriangle, MessageSquare, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sidebar } from "./sidebar";
import { SchedulerControl } from "./scheduler-control";
import { ChatPanel } from "@/components/chat/chat-panel";
import { UpdateBanner } from "@/components/shared/update-banner";
import { LicenseBanner, shouldShowLicenseBanner } from "@/components/shared/license-banner";
import { useLicense } from "@/hooks/use-license";
import { useClaudeHealth } from "@/hooks/use-claude-health";
import { useChatStore } from "@/stores/chat-store";
import { useAppStore } from "@/stores/app-store";
import { useUpdaterStore } from "@/stores/updater-store";
import { useUpdater } from "@/hooks/use-updater";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface AppShellProps {
  children: React.ReactNode;
  rightPanel?: React.ReactNode;
  onNewProject?: () => void;
  onEditProject?: (projectId: string) => void;
  onNewJobForGoal: (goalId: string, initialName: string) => void;
}

export function AppShell({
  children,
  rightPanel,
  onNewProject,
  onEditProject,
  onNewJobForGoal,
}: AppShellProps) {
  const { panelOpen, togglePanel } = useChatStore();
  const { activeProjectId } = useAppStore();
  const { shouldCheckUpdates } = useUpdaterStore();
  const { licenseStatus } = useLicense();
  const claudeHealth = useClaudeHealth();
  const {
    status,
    updateVersion,
    downloadProgress,
    error,
    activeRunCount,
    checkForUpdate,
    installUpdate,
    forceInstallUpdate,
    waitAndInstall,
    dismissUpdate,
  } = useUpdater();

  // Trigger check once when the app signals it's ready, then re-check every hour
  useEffect(() => {
    if (!shouldCheckUpdates) return;
    void checkForUpdate();
    const interval = setInterval(() => { void checkForUpdate(); }, 60 * 60 * 1_000);
    return () => clearInterval(interval);
  }, [shouldCheckUpdates, checkForUpdate]);

  const showBanner =
    status !== "idle" && status !== "not-available";

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar onNewProject={onNewProject} onEditProject={onEditProject} onNewJobForGoal={onNewJobForGoal} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header strip — h-12 matches sidebar logo row; drag region + chat toggle */}
        <div
          data-tauri-drag-region
          onMouseDown={() => { if ("__TAURI_INTERNALS__" in window) getCurrentWindow().startDragging(); }}
          className="flex h-12 shrink-0 items-center justify-end gap-2 border-b border-border px-3"
        >
          {licenseStatus && shouldShowLicenseBanner(licenseStatus) && (
            <LicenseBanner licenseStatus={licenseStatus} />
          )}
          {showBanner && (
            <UpdateBanner
              status={status}
              updateVersion={updateVersion}
              downloadProgress={downloadProgress}
              error={error}
              activeRunCount={activeRunCount}
              onInstall={installUpdate}
              onForceInstall={forceInstallUpdate}
              onWaitAndInstall={waitAndInstall}
              onDismiss={dismissUpdate}
              onRetry={checkForUpdate}
            />
          )}
          <SchedulerControl />
          {!panelOpen && (
            <Button
              variant="outline"
              size="xs"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={togglePanel}
              className="gap-1.5"
              title="Open chat"
            >
              <MessageSquare className="size-3" />
              Chat
            </Button>
          )}
        </div>
        {/* Claude Code health warning */}
        {claudeHealth.error && (
          <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="flex-1">{claudeHealth.error}</span>
            <button
              type="button"
              onClick={claudeHealth.recheck}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-3xs font-medium text-destructive hover:bg-destructive/10"
              title="Recheck"
            >
              <RefreshCw className="size-3" />
              Retry
            </button>
            <button
              type="button"
              onClick={claudeHealth.dismiss}
              className="shrink-0 text-destructive/60 hover:text-destructive"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
      {rightPanel && (
        <div className="flex h-full w-[440px] shrink-0 flex-col border-l border-border bg-card">
          {rightPanel}
        </div>
      )}
      <ChatPanel projectId={activeProjectId} />
    </div>
  );
}

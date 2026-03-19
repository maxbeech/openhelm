import { useEffect } from "react";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sidebar } from "./sidebar";
import { ChatPanel } from "@/components/chat/chat-panel";
import { UpdateBanner } from "@/components/shared/update-banner";
import { LicenseBanner, shouldShowLicenseBanner } from "@/components/shared/license-banner";
import { useLicense } from "@/hooks/use-license";
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
  const {
    status,
    updateVersion,
    downloadProgress,
    error,
    checkForUpdate,
    installUpdate,
    dismissUpdate,
  } = useUpdater();

  // Trigger check once when the app signals it's ready
  useEffect(() => {
    if (shouldCheckUpdates) {
      void checkForUpdate();
    }
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
          onMouseDown={() => { getCurrentWindow().startDragging(); }}
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
              onInstall={installUpdate}
              onDismiss={dismissUpdate}
              onRetry={checkForUpdate}
            />
          )}
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
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
      {rightPanel && (
        <div className="flex h-full w-[440px] shrink-0 flex-col border-l border-border bg-card">
          {rightPanel}
        </div>
      )}
      {activeProjectId && <ChatPanel projectId={activeProjectId} />}
    </div>
  );
}

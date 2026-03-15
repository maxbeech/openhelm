import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sidebar } from "./sidebar";
import { ChatPanel } from "@/components/chat/chat-panel";
import { useChatStore } from "@/stores/chat-store";
import { useAppStore } from "@/stores/app-store";

interface AppShellProps {
  children: React.ReactNode;
  rightPanel?: React.ReactNode;
  onNewProject?: () => void;
  onNewJobForGoal: (goalId: string, initialName: string) => void;
}

export function AppShell({
  children,
  rightPanel,
  onNewProject,
  onNewJobForGoal,
}: AppShellProps) {
  const { panelOpen, togglePanel } = useChatStore();
  const { activeProjectId } = useAppStore();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar onNewProject={onNewProject} onNewJobForGoal={onNewJobForGoal} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Chat toggle button — hidden when panel is already open */}
        {!panelOpen && (
          <div className="absolute top-3 right-3 z-10">
            <Button
              variant="outline"
              size="sm"
              onClick={togglePanel}
              className="gap-1.5 text-xs"
              title="Open chat"
            >
              <MessageSquare className="size-3.5" />
              Chat
            </Button>
          </div>
        )}
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

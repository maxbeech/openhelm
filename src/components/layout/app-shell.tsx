import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sidebar } from "./sidebar";
import { RunsPanel } from "./runs-panel";
import { ChatPanel } from "@/components/chat/chat-panel";
import { useChatStore } from "@/stores/chat-store";
import { useAppStore } from "@/stores/app-store";

interface AppShellProps {
  children: React.ReactNode;
  onNewProject?: () => void;
  onNewJobForGoal: (goalId: string, initialName: string) => void;
}

export function AppShell({
  children,
  onNewProject,
  onNewJobForGoal,
}: AppShellProps) {
  const { panelOpen, togglePanel } = useChatStore();
  const { activeProjectId, contentView } = useAppStore();
  const showRunsPanel =
    contentView === "goal-detail" || contentView === "job-detail" || contentView === "run-detail";

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar onNewProject={onNewProject} onNewJobForGoal={onNewJobForGoal} />
      {showRunsPanel && <RunsPanel />}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Chat toggle button */}
        <div className="absolute top-3 right-3 z-10">
          <Button
            variant={panelOpen ? "secondary" : "outline"}
            size="sm"
            onClick={togglePanel}
            className="gap-1.5 text-xs"
            title="Toggle AI chat"
          >
            <MessageSquare className="size-3.5" />
            AI Chat
          </Button>
        </div>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
      {activeProjectId && <ChatPanel projectId={activeProjectId} />}
    </div>
  );
}

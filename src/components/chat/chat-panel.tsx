import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/stores/chat-store";
import { useAppStore } from "@/stores/app-store";
import { useGoalStore } from "@/stores/goal-store";
import { useJobStore } from "@/stores/job-store";
import { useRunStore } from "@/stores/run-store";
import { useResizePanel } from "@/hooks/use-resize-panel";
import { ChatMessageList } from "./chat-message-list";
import { ChatInput } from "./chat-input";
import { ThreadTabs } from "./thread-tabs";
import type { ChatContext } from "@openhelm/shared";

interface ChatPanelProps {
  /** null = "All Projects" thread */
  projectId: string | null;
}

export function ChatPanel({ projectId }: ChatPanelProps) {
  const {
    messages,
    panelOpen,
    closePanel,
    sendMessage,
    activeConversationId,
    conversationStates,
  } = useChatStore();
  const error = useChatStore((s) => s.error);
  const clearError = useChatStore((s) => s.clearError);

  // Per-conversation transient state
  const convState = activeConversationId
    ? (conversationStates[activeConversationId] ?? { sending: false, statusText: null, streamingText: "" })
    : { sending: false, statusText: null, streamingText: "" };
  const { sending } = convState;

  const { selectedGoalId, selectedJobId, selectedRunId, contentView } =
    useAppStore();
  const { width, dragHandleProps } = useResizePanel({
    minWidth: 280,
    maxWidth: 600,
    defaultWidth: 360,
    storageKey: "chat-panel-width",
  });

  if (!panelOpen) return null;

  const handleSend = (content: string) => {
    const { goals } = useGoalStore.getState();
    const { jobs } = useJobStore.getState();
    const { runs } = useRunStore.getState();

    const context: ChatContext = {
      viewingGoalId:
        contentView === "goal-detail" && selectedGoalId && goals.some((g) => g.id === selectedGoalId)
          ? selectedGoalId
          : undefined,
      viewingJobId:
        contentView === "job-detail" && selectedJobId && jobs.some((j) => j.id === selectedJobId)
          ? selectedJobId
          : undefined,
      viewingRunId:
        selectedRunId && runs.some((r) => r.id === selectedRunId)
          ? selectedRunId
          : undefined,
    };
    sendMessage(projectId, content, context).catch(() => {});
  };

  return (
    <div
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-background"
      style={{ width }}
    >
      {/* Resize drag handle */}
      <div
        {...dragHandleProps}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-10"
      />
      {/* Header */}
      <div data-tauri-drag-region className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <h3 className="text-sm font-semibold">Chat</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={closePanel}
          className="size-7 p-0 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Thread tabs */}
      <ThreadTabs projectId={projectId} />

      {/* Messages */}
      <ChatMessageList
        messages={messages}
        sending={sending}
        projectId={projectId ?? "__all__"}
      />

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 border-t border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={clearError}
            className="shrink-0 text-destructive/60 hover:text-destructive"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={sending} />
    </div>
  );
}

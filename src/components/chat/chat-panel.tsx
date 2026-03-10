import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/stores/chat-store";
import { useAppStore } from "@/stores/app-store";
import { useResizePanel } from "@/hooks/use-resize-panel";
import { ChatMessageList } from "./chat-message-list";
import { ChatInput } from "./chat-input";
import type { ChatContext } from "@openorchestra/shared";

interface ChatPanelProps {
  projectId: string;
}

export function ChatPanel({ projectId }: ChatPanelProps) {
  const {
    messages,
    sending,
    panelOpen,
    closePanel,
    sendMessage,
    clearChat,
  } = useChatStore();

  const { selectedGoalId, selectedJobId, selectedRunId, contentView } = useAppStore();
  const { width, dragHandleProps } = useResizePanel({
    minWidth: 280,
    maxWidth: 600,
    defaultWidth: 360,
    storageKey: "chat-panel-width",
  });

  if (!panelOpen) return null;

  const handleSend = (content: string) => {
    const context: ChatContext = {
      viewingGoalId:
        contentView === "goal-detail" ? selectedGoalId ?? undefined : undefined,
      viewingJobId:
        contentView === "job-detail" ? selectedJobId ?? undefined : undefined,
      viewingRunId:
        contentView === "run-detail" ? selectedRunId ?? undefined : undefined,
    };
    sendMessage(projectId, content, context).catch(() => {});
  };

  const handleClear = () => {
    if (messages.length === 0) return;
    clearChat(projectId).catch(() => {});
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
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">AI Assistant</h3>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              title="Clear chat history"
              className="size-7 p-0 text-muted-foreground hover:text-foreground"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={closePanel}
            className="size-7 p-0 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ChatMessageList
        messages={messages}
        sending={sending}
        projectId={projectId}
      />

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={sending} />
    </div>
  );
}

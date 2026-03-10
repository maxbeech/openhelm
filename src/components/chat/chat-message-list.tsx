import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { ChatMessageBubble } from "./chat-message-bubble";
import { useChatStore } from "@/stores/chat-store";
import type { ChatMessage } from "@openorchestra/shared";

interface ChatMessageListProps {
  messages: ChatMessage[];
  sending: boolean;
  projectId: string;
}

export function ChatMessageList({ messages, sending, projectId }: ChatMessageListProps) {
  const statusText = useChatStore((s) => s.statusText);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending]);

  if (messages.length === 0 && !sending) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        <p className="font-medium">Chat with your AI assistant</p>
        <p className="max-w-[200px] text-xs">
          Ask about your goals and jobs, get feedback on failures, or let the AI set things up for you.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      {messages.map((msg) => (
        <ChatMessageBubble key={msg.id} message={msg} projectId={projectId} />
      ))}
      {sending && (
        <div className="flex items-start gap-2">
          <div className="flex items-center gap-1.5 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {statusText ?? "Thinking..."}
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

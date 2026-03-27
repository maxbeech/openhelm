import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatMessageBubble } from "./chat-message-bubble";
import { useChatStore } from "@/stores/chat-store";
import type { ChatMessage } from "@openhelm/shared";

interface ChatMessageListProps {
  messages: ChatMessage[];
  sending: boolean;
  projectId: string;
}

export function ChatMessageList({ messages, sending, projectId }: ChatMessageListProps) {
  const statusText = useChatStore((s) => s.statusText);
  const streamingText = useChatStore((s) => s.streamingText);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages or streaming chunks
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending, streamingText]);

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
        <>
          {/* Status indicator */}
          <div className="flex items-start gap-2">
            <div className="flex items-center gap-1.5 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {statusText ?? "Thinking..."}
            </div>
          </div>
          {/* Streaming text preview — shown as Claude generates the response */}
          {streamingText && (
            <div className="flex flex-col items-start">
              <div className="max-w-[85%] rounded-xl bg-muted px-3 py-2 text-sm text-foreground opacity-80">
                <div className="markdown-content break-words leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {streamingText.replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, "")}
                  </ReactMarkdown>
                </div>
                {/* Blinking cursor to signal live generation */}
                <span className="inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-foreground/50" />
              </div>
            </div>
          )}
        </>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

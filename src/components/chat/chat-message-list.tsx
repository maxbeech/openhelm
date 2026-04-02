import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatMessageBubble } from "./chat-message-bubble";
import { AnimatedHelmLogo } from "./animated-helm-logo";
import { useChatStore } from "@/stores/chat-store";
import type { ChatMessage } from "@openhelm/shared";

interface ChatMessageListProps {
  messages: ChatMessage[];
  sending: boolean;
  projectId: string;
}

export function ChatMessageList({ messages, sending, projectId }: ChatMessageListProps) {
  const activeConvId = useChatStore((s) => s.activeConversationId);
  const convState = useChatStore((s) => activeConvId ? s.conversationStates[activeConvId] : null);
  const statusText = convState?.statusText ?? null;
  const streamingText = convState?.streamingText ?? "";
  const bottomRef = useRef<HTMLDivElement>(null);

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

  // If the last message is already an assistant response, the streaming
  // indicator must not show. The appendConvStreaming store guard also
  // prevents stale text from accumulating after sending is cleared.
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const showSending = sending && lastMsg?.role !== "assistant";

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      {messages.map((msg) => {
        if (msg.role === "user") {
          return <ChatMessageBubble key={msg.id} message={msg} projectId={projectId} />;
        }
        return (
          <div key={msg.id} className="flex items-start gap-2">
            <div className="mt-1 flex-shrink-0">
              <AnimatedHelmLogo animating={false} size={28} />
            </div>
            <ChatMessageBubble message={msg} projectId={projectId} />
          </div>
        );
      })}

      {showSending && (
        <div className="flex items-start gap-2">
          <div className="mt-1 flex-shrink-0">
            <AnimatedHelmLogo animating={true} size={28} />
          </div>
          <div className="flex flex-col items-start gap-2">
            {!streamingText && statusText && (
              <div className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                {statusText}
              </div>
            )}
            {streamingText && (
              <div className="max-w-[85%] rounded-xl bg-muted px-3 py-2 text-sm text-foreground opacity-80">
                <div className="markdown-content break-words leading-relaxed [&>*:last-child]:inline">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {streamingText.replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, "")}
                  </ReactMarkdown>
                  <span className="inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-foreground/50" />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

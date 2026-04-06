import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useShallow } from "zustand/react/shallow";
import { ChatMessageBubble, fixSplitNegatives, isPlainText } from "./chat-message-bubble";
import { AnimatedHelmLogo } from "./animated-helm-logo";
import { useChatStore } from "@/stores/chat-store";
import type { ChatMessage } from "@openhelm/shared";

interface ChatMessageListProps {
  messages: ChatMessage[];
  sending: boolean;
  projectId: string;
}

const STREAMING_ID = "__streaming__";
/** Stable key for the latest assistant response slot. Using a fixed key
 *  makes React UPDATE the existing DOM node in-place when streaming text
 *  transitions to the committed message, instead of unmounting one node
 *  and mounting a different one (which can flash in the Tauri WebView). */
const LATEST_RESPONSE_KEY = "__latest_response__";

/**
 * Single selector that reads messages + conversation transient state from
 * the SAME Zustand snapshot. Using separate selectors for messages and
 * convState could cause tearing (one selector sees the committed message
 * while the other still has stale streamingText), which briefly shows the
 * response text doubled during the streaming→committed transition.
 */
function useChatSnapshot() {
  return useChatStore(
    useShallow((s) => {
      const convId = s.activeConversationId;
      const cs = convId ? s.conversationStates[convId] : null;
      return {
        messages: s.messages,
        activeConvId: convId,
        statusText: cs?.statusText ?? null,
        streamingText: cs?.streamingText ?? "",
        storeSending: cs?.sending ?? false,
      };
    }),
  );
}

export function ChatMessageList({ sending, projectId }: ChatMessageListProps) {
  const { messages, activeConvId, statusText, streamingText, storeSending } = useChatSnapshot();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Use instant scroll to avoid smooth-scroll animation amplifying
    // the visual flash during streaming→committed transition.
    bottomRef.current?.scrollIntoView({ behavior: "instant" });
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

  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const lastIsAssistant = lastMsg?.role === "assistant";

  // Inject virtual streaming message into the display list
  const hasStreamingContent = streamingText.length > 0 && !lastIsAssistant;
  const displayMessages: (ChatMessage & { _streaming?: boolean })[] = [...messages];
  if (hasStreamingContent) {
    displayMessages.push({
      id: STREAMING_ID,
      conversationId: activeConvId ?? "",
      role: "assistant",
      content: fixSplitNegatives(
        streamingText
          .replace(/<tool_call\b[^>]*>[\s\S]*?(<\/tool_call>|$)/g, "")
          .replace(/<tool_result\b[^>]*>[\s\S]*?(<\/tool_result>|$)/g, "")
          .replace(/\[Tool results from above\]\s*/g, "")
          .replace(/Continue your response based on the tool results above\.\s*/g, "")
          .replace(/^\s*(?:Assistant|User):\s*/gm, ""),
      ),
      toolCalls: null,
      toolResults: null,
      pendingActions: null,
      createdAt: new Date().toISOString(),
      _streaming: true,
    } as ChatMessage & { _streaming?: boolean });
  }

  const showLoader = (sending || storeSending) && !lastIsAssistant && !streamingText;

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      {displayMessages.map((msg, idx) => {
        // Use a stable key for the last assistant message position so React
        // updates the DOM node in-place during streaming→committed swap.
        const isLastEntry = idx === displayMessages.length - 1;
        const isAssistant = msg.role === "assistant";
        const key = isLastEntry && isAssistant ? LATEST_RESPONSE_KEY : msg.id;

        if (msg.role === "user") {
          return <ChatMessageBubble key={key} message={msg} projectId={projectId} />;
        }

        const isStreaming = (msg as ChatMessage & { _streaming?: boolean })._streaming === true;

        return (
          <div key={key} className="flex items-start gap-2">
            <div className="mt-1 flex-shrink-0">
              <AnimatedHelmLogo animating={isStreaming} size={28} />
            </div>
            {isStreaming ? (
              <div className="flex flex-col items-start">
                <div className="max-w-[85%] rounded-xl bg-muted px-3 py-2 text-sm text-foreground opacity-80">
                  {isPlainText(msg.content ?? "") ? (
                    <p className="whitespace-pre-wrap break-words leading-relaxed">
                      {msg.content ?? ""}
                      <span className="inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-foreground/50" />
                    </p>
                  ) : (
                    <div className="markdown-content break-words leading-relaxed [&>*:last-child]:inline">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content ?? ""}
                      </ReactMarkdown>
                      <span className="inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-foreground/50" />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <ChatMessageBubble message={msg} projectId={projectId} />
            )}
          </div>
        );
      })}

      {showLoader && (
        <div className="flex items-start gap-2">
          <div className="mt-1 flex-shrink-0">
            <AnimatedHelmLogo animating={true} size={28} />
          </div>
          {statusText && (
            <div className="flex flex-col items-start gap-2">
              <div className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                {statusText}
              </div>
            </div>
          )}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

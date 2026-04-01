import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { ActionGroup } from "./action-group";
import type { ChatMessage } from "@openhelm/shared";

/** Defence-in-depth: strip any <tool_call> XML that leaked past the agent parser. */
function stripToolCallXml(text: string): string {
  return text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
}

interface ChatMessageBubbleProps {
  message: ChatMessage;
  projectId: string;
}

export function ChatMessageBubble({ message, projectId }: ChatMessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "flex flex-col",
        isUser ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-3 py-2 text-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {message.content ? (
          isUser ? (
            <p className="whitespace-pre-wrap break-words leading-relaxed">
              {message.content}
            </p>
          ) : (
            <div className="markdown-content break-words leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{stripToolCallXml(message.content)}</ReactMarkdown>
            </div>
          )
        ) : !isUser && message.pendingActions?.length ? (
          <p className="text-xs text-muted-foreground">Suggested actions:</p>
        ) : null}

        {/* Pending write-action group with batch approve/request change */}
        {message.pendingActions && message.pendingActions.length > 0 && (
          <ActionGroup
            messageId={message.id}
            actions={message.pendingActions}
            projectId={projectId}
          />
        )}
      </div>
      <span className="mt-0.5 px-1 text-3xs text-muted-foreground">
        {new Date(message.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    </div>
  );
}

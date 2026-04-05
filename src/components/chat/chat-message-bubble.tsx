import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ActionGroup } from "./action-group";
import type { ChatMessage } from "@openhelm/shared";

/** Defence-in-depth: strip any <tool_call> XML that leaked past the agent parser. */
function stripToolCallXml(text: string): string {
  return text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
}

/** Fix LLM output where negative numbers are split across lines (e.g. "-\n2" → "-2").
 *  A lone dash/plus at end of line followed by a digit is a split negative number. */
export function fixSplitNegatives(text: string): string {
  return text.replace(/^(-)\n(\d)/gm, "$1$2");
}

/** Detect content that has no markdown syntax needing rendering — render as plain
 *  text to avoid Markdown parsing artifacts (like "-" being parsed as a list). */
export function isPlainText(text: string): boolean {
  // No markdown block/inline syntax characters that need rendering
  return !/[*_`#>[\]|]|^\s*[-+*]\s|\n\n|```/m.test(text);
}

interface ChatMessageBubbleProps {
  message: ChatMessage;
  projectId: string;
}

export function ChatMessageBubble({ message, projectId }: ChatMessageBubbleProps) {
  const isUser = message.role === "user";

  const content = (
    <>
      <div
        className={cn(
          "max-w-[85%] min-w-[10rem] rounded-xl px-3 py-2 text-sm",
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
          ) : (() => {
            const cleaned = fixSplitNegatives(stripToolCallXml(message.content));
            const plain = isPlainText(cleaned);
            // For plain text (no markdown syntax), render as a simple paragraph
            // to avoid ReactMarkdown treating "-" prefixes as list items.
            if (plain) {
              return (
                <p className="whitespace-pre-wrap break-words leading-relaxed">
                  {cleaned}
                </p>
              );
            }
            return (
              <div className="markdown-content break-words leading-relaxed">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    table: ({ children }) => (
                      <div className="overflow-x-auto">
                        <table>{children}</table>
                      </div>
                    ),
                  }}
                >{cleaned}</ReactMarkdown>
              </div>
            );
          })()
        ) : !isUser && message.pendingActions?.length ? (
          <p className="text-xs text-muted-foreground">Suggested actions:</p>
        ) : null}

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
    </>
  );

  // Only user messages get entrance animation. Assistant messages always
  // render with a plain div to prevent unmount/remount flashes during the
  // streaming → final message transition.
  if (!isUser) {
    return (
      <div className="flex flex-col items-start">
        {content}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
      className="flex flex-col items-end"
    >
      {content}
    </motion.div>
  );
}

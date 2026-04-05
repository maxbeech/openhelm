import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { InboxEvent } from "@openhelm/shared";

interface Props {
  event: InboxEvent;
  timestamp: string;
  isUnread?: boolean;
}

export function EventAiMessage({ event, timestamp, isUnread: _isUnread }: Props) {
  const meta = event.metadata as Record<string, unknown>;
  const hasActions = (meta.hasActions as boolean) || event.category === "action";
  // For alerts/actions, show title as a bold header followed by the body.
  // For chat messages, the body IS the content (title is a truncated preview).
  const isAlertLike = event.category === "alert" || event.category === "action";
  const content = isAlertLike
    ? (event.body ? `**${event.title}**\n\n${event.body}` : `**${event.title}**`)
    : (event.body || event.title);

  return (
    <div className="my-2 max-w-[85%]">
      <div className="rounded-xl bg-muted px-4 py-3 transition-colors hover:bg-muted/80">
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="text-3xs text-muted-foreground">{timestamp}</span>
        </div>
        <div className="markdown-content text-sm leading-relaxed [&>*:last-child]:mb-0 [&>p]:mb-2 [&>ul]:mb-2 [&>ol]:mb-2 [&>h1]:mb-2 [&>h2]:mb-2 [&>h3]:mb-2 [&>pre]:mb-2 [&>blockquote]:mb-2 [&>ul]:list-disc [&>ul]:pl-4 [&>ol]:list-decimal [&>ol]:pl-4 [&>code]:rounded [&>code]:bg-muted-foreground/20 [&>code]:px-1 [&>code]:py-0.5 [&>code]:text-xs">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content ?? ""}</ReactMarkdown>
        </div>
        {hasActions && (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-3xs font-medium text-primary">
              Action required
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

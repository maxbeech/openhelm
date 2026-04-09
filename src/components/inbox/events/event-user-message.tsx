import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Reply } from "lucide-react";
import { useInboxStore } from "@/stores/inbox-store";
import type { InboxEvent } from "@openhelm/shared";

interface Props {
  event: InboxEvent;
  timestamp: string;
  isUnread?: boolean;
}

export function EventUserMessage({ event, timestamp, isUnread: _isUnread }: Props) {
  const content = event.body || event.title;

  // Look up the referenced event for reply context display
  const referencedEvent = useInboxStore((s) =>
    event.replyToEventId
      ? s.events.find((e) => e.id === event.replyToEventId) ?? null
      : null,
  );
  const refContent = referencedEvent
    ? (referencedEvent.body || referencedEvent.title)
    : null;

  return (
    <div className="my-2 flex justify-end">
      <div className="max-w-[85%]">
        {/* Quoted reply reference */}
        {refContent && (
          <div className="mb-1 mr-1 flex items-start gap-1 text-right">
            <Reply className="mt-0.5 size-2.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 overflow-hidden rounded-md border-l-2 border-primary/30 bg-muted/50 pl-2 pr-2 py-1 text-left text-[10px] text-muted-foreground">
              <div className="line-clamp-2 leading-snug [&>p]:m-0 [&>strong]:font-medium [&>em]:italic">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{refContent}</ReactMarkdown>
              </div>
            </div>
          </div>
        )}
        <div className="rounded-xl bg-primary px-4 py-3 text-primary-foreground">
          <div className="mb-1 flex items-center justify-end gap-1.5">
            <span className="text-3xs text-primary-foreground/60">{timestamp}</span>
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
        </div>
      </div>
    </div>
  );
}

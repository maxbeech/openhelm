import { MessageSquare } from "lucide-react";
import type { InboxEvent } from "@openhelm/shared";

interface Props {
  event: InboxEvent;
  timestamp: string;
}

export function EventConversationThread({ event, timestamp }: Props) {
  const meta = event.metadata as Record<string, unknown>;
  const threadTitle = (meta.conversationTitle as string) || "Chat thread";

  // Format "last updated" — use eventAt which is updated on each upsert
  const lastUpdated = new Date(event.eventAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="rounded-lg border border-border/60 bg-card px-4 py-3 transition-colors hover:bg-accent/30">
      <div className="flex items-center gap-2.5">
        <MessageSquare className="size-3.5 shrink-0 text-primary/70" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {threadTitle}
        </span>
        <span className="shrink-0 text-3xs text-muted-foreground">{timestamp}</span>
      </div>
      <p className="mt-1 truncate pl-6 text-xs text-muted-foreground">
        Last updated {lastUpdated}
      </p>
    </div>
  );
}

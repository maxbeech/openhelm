import { MessageSquare } from "lucide-react";
import type { InboxEvent } from "@openhelm/shared";
import { EventRow } from "./event-row";

interface Props {
  event: InboxEvent;
  timestamp: string;
  isUnread?: boolean;
}

export function EventConversationThread({ event, timestamp, isUnread }: Props) {
  const meta = event.metadata as Record<string, unknown>;
  const threadTitle = (meta.conversationTitle as string) || "Chat thread";

  return (
    <EventRow
      icon={MessageSquare}
      title={threadTitle}
      description={event.body}
      timestamp={timestamp}
      isUnread={isUnread}
    />
  );
}

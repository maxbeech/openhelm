import { useCallback } from "react";
import { Reply } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { useInboxStore } from "@/stores/inbox-store";
import { useChatStore } from "@/stores/chat-store";
import { EventJobRun } from "./events/event-job-run";
import { EventAiMessage } from "./events/event-ai-message";
import { EventUserMessage } from "./events/event-user-message";
import { EventConversationThread } from "./events/event-conversation-thread";
import { EventCrud } from "./events/event-crud";
import { EventScheduledRun } from "./events/event-scheduled-run";
import type { InboxEvent as InboxEventType } from "@openhelm/shared";

interface Props {
  event: InboxEventType;
  isUnread?: boolean;
}

export function InboxEvent({ event, isUnread }: Props) {
  const { selectRun, selectDataTable, selectJob, setContentView } = useAppStore();
  const { setReplyContext } = useInboxStore();
  const { setActiveConversation, panelOpen, togglePanel } = useChatStore();

  const handleClick = useCallback(() => {
    const meta = event.metadata as Record<string, unknown>;
    switch (event.category) {
      case "run":
        if (meta.runId) selectRun(meta.runId as string, meta.jobId as string);
        break;
      case "alert":
        if (meta.runId) selectRun(meta.runId as string, meta.jobId as string);
        break;
      case "data":
        if (meta.tableId) selectDataTable(meta.tableId as string);
        break;
      case "memory":
        setContentView("memory");
        break;
      case "credential":
        setContentView("credentials");
        break;
      case "system":
        if (meta.jobId) selectJob(meta.jobId as string);
        break;
      case "chat":
        if (event.eventType === "chat.conversation_thread" && meta.conversationId) {
          setActiveConversation(meta.conversationId as string);
          if (!panelOpen) togglePanel();
        }
        break;
    }
  }, [event, selectRun, selectDataTable, selectJob, setContentView, setActiveConversation, panelOpen, togglePanel]);

  const handleReply = useCallback(() => {
    setReplyContext({
      eventId: event.id,
      preview: event.title,
    });
  }, [event, setReplyContext]);

  const timestamp = new Date(event.eventAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className={cn(
        "group relative my-2 rounded-md transition-colors",
        isUnread && "bg-accent/20",
      )}
    >
      {/* Reply button — appears on hover, right side */}
      <button
        onClick={handleReply}
        className="absolute -right-1 top-1/2 -translate-y-1/2 rounded p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
        title="Reply"
      >
        <Reply className="size-3 text-muted-foreground" />
      </button>

      <div onClick={handleClick} className="cursor-pointer pr-4">
        {/* Alerts and actions render as AI messages (treat agent feedback uniformly) */}
        {(event.category === "alert" || event.category === "action") && (
          <EventAiMessage event={event} timestamp={timestamp} isUnread={isUnread} />
        )}
        {event.category === "run" && <EventJobRun event={event} timestamp={timestamp} isUnread={isUnread} />}
        {event.category === "chat" && event.eventType === "chat.conversation_thread" && (
          <EventConversationThread event={event} timestamp={timestamp} isUnread={isUnread} />
        )}
        {event.category === "chat" && event.eventType === "chat.assistant_message" && (
          <EventAiMessage event={event} timestamp={timestamp} isUnread={isUnread} />
        )}
        {event.category === "chat" && event.eventType === "chat.user_message" && (
          <EventUserMessage event={event} timestamp={timestamp} isUnread={isUnread} />
        )}
        {event.category === "system" && event.eventType === "system.scheduled_run" && (
          <EventScheduledRun event={event} timestamp={timestamp} isUnread={isUnread} />
        )}
        {(event.category === "memory" ||
          event.category === "data" ||
          event.category === "credential" ||
          event.category === "insight") && (
          <EventCrud event={event} timestamp={timestamp} isUnread={isUnread} />
        )}
      </div>
    </div>
  );
}

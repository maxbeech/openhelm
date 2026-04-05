import { CalendarClock } from "lucide-react";
import type { InboxEvent } from "@openhelm/shared";
import { EventRow } from "./event-row";

interface Props {
  event: InboxEvent;
  timestamp: string;
  isUnread?: boolean;
}

export function EventScheduledRun({ event, timestamp, isUnread }: Props) {
  const meta = event.metadata as Record<string, unknown>;
  const jobName = (meta.jobName as string) || "Job";
  const scheduleType = meta.scheduleType as string | undefined;

  return (
    <EventRow
      icon={CalendarClock}
      title={jobName}
      badge={
        scheduleType
          ? { label: scheduleType, className: "bg-muted text-muted-foreground" }
          : undefined
      }
      timestamp={timestamp}
      isUnread={isUnread}
    />
  );
}

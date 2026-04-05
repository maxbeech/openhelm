import { Waypoints, Database, KeyRound, Compass } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { InboxEvent } from "@openhelm/shared";
import { EventRow } from "./event-row";

interface Props {
  event: InboxEvent;
  timestamp: string;
  isUnread?: boolean;
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  memory: Waypoints,
  data: Database,
  credential: KeyRound,
  insight: Compass,
};

export function EventCrud({ event, timestamp, isUnread }: Props) {
  const icon = CATEGORY_ICONS[event.category] ?? Database;

  return (
    <EventRow
      icon={icon}
      title={event.title}
      description={event.body}
      timestamp={timestamp}
      isUnread={isUnread}
    />
  );
}

import { Waypoints, Database, KeyRound, Compass, Zap } from "lucide-react";
import type { InboxEvent } from "@openhelm/shared";

interface Props {
  event: InboxEvent;
  timestamp: string;
}

const CATEGORY_ICONS: Record<string, typeof Database> = {
  memory: Waypoints,
  data: Database,
  credential: KeyRound,
  insight: Compass,
  action: Zap,
};

export function EventCrud({ event, timestamp }: Props) {
  const Icon = CATEGORY_ICONS[event.category] ?? Database;

  return (
    <div className="flex items-center gap-2 rounded-md px-3 py-1 transition-colors hover:bg-accent/30">
      <Icon className="size-3 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {event.title}
      </span>
      <span className="shrink-0 text-3xs text-muted-foreground">{timestamp}</span>
    </div>
  );
}

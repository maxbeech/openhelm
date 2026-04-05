import { CalendarClock } from "lucide-react";
import type { InboxEvent } from "@openhelm/shared";

interface Props {
  event: InboxEvent;
  timestamp: string;
}

export function EventScheduledRun({ event, timestamp }: Props) {
  const meta = event.metadata as Record<string, unknown>;
  const jobName = (meta.jobName as string) || "Job";
  const scheduleType = meta.scheduleType as string | undefined;

  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-card/30 px-4 py-3 transition-colors hover:bg-accent/20">
      <div className="flex items-center gap-2.5">
        <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{jobName}</span>
        {scheduleType && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-3xs text-muted-foreground">
            {scheduleType}
          </span>
        )}
        <span className="shrink-0 text-3xs text-muted-foreground">{timestamp}</span>
      </div>
    </div>
  );
}

import { Play, CheckCircle2, XCircle, AlertTriangle, Ban } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { InboxEvent } from "@openhelm/shared";
import { EventRow, type EventRowBadge } from "./event-row";

interface Props {
  event: InboxEvent;
  timestamp: string;
  isUnread?: boolean;
}

const STATUS_CONFIG: Record<
  string,
  { icon: LucideIcon; iconColor: string; badge: EventRowBadge }
> = {
  running: {
    icon: Play,
    iconColor: "text-primary",
    badge: { label: "Running", className: "bg-primary/10 text-primary" },
  },
  succeeded: {
    icon: CheckCircle2,
    iconColor: "text-emerald-500",
    badge: { label: "Succeeded", className: "bg-emerald-500/10 text-emerald-500" },
  },
  failed: {
    icon: XCircle,
    iconColor: "text-destructive",
    badge: { label: "Failed", className: "bg-destructive/10 text-destructive" },
  },
  permanent_failure: {
    icon: AlertTriangle,
    iconColor: "text-destructive",
    badge: { label: "Permanent Failure", className: "bg-destructive/10 text-destructive" },
  },
  cancelled: {
    icon: Ban,
    iconColor: "text-muted-foreground",
    badge: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
  },
};

export function EventJobRun({ event, timestamp, isUnread }: Props) {
  const meta = event.metadata as Record<string, unknown>;
  const status = (meta.status as string) || "running";
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.running;
  const jobName = (meta.jobName as string) || "Job";

  return (
    <EventRow
      icon={config.icon}
      iconColor={config.iconColor}
      title={jobName}
      description={event.body}
      badge={config.badge}
      timestamp={timestamp}
      isUnread={isUnread}
    />
  );
}

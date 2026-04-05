import { AlertTriangle, KeyRound, Monitor, ShieldAlert } from "lucide-react";
import type { InboxEvent } from "@openhelm/shared";

interface Props {
  event: InboxEvent;
  timestamp: string;
}

const ALERT_ICONS: Record<string, typeof AlertTriangle> = {
  "alert.permanent_failure": AlertTriangle,
  "alert.auth_required": KeyRound,
  "alert.captcha_intervention": ShieldAlert,
  "alert.mcp_unavailable": Monitor,
};

const ALERT_COLORS: Record<string, string> = {
  "alert.permanent_failure": "border-l-destructive",
  "alert.auth_required": "border-l-amber-500",
  "alert.captcha_intervention": "border-l-amber-500",
  "alert.human_in_loop": "border-l-blue-500",
  "alert.mcp_unavailable": "border-l-orange-500",
  "alert.autopilot_limit": "border-l-yellow-500",
};

export function EventAlert({ event, timestamp }: Props) {
  const Icon = ALERT_ICONS[event.eventType] ?? AlertTriangle;
  const borderColor = ALERT_COLORS[event.eventType] ?? "border-l-destructive";

  return (
    <div className={`rounded-lg border border-border bg-card p-3 border-l-4 ${borderColor} transition-colors hover:bg-accent/30`}>
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{event.title}</span>
            <span className="shrink-0 text-3xs text-muted-foreground">{timestamp}</span>
          </div>
          {event.body && (
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
              {event.body}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

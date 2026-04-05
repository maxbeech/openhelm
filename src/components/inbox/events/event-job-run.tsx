import { Play, CheckCircle2, XCircle, AlertTriangle, Ban } from "lucide-react";
import type { InboxEvent } from "@openhelm/shared";

interface Props {
  event: InboxEvent;
  timestamp: string;
}

const STATUS_CONFIG: Record<string, { icon: typeof Play; color: string; label: string }> = {
  running: { icon: Play, color: "text-primary", label: "Running" },
  succeeded: { icon: CheckCircle2, color: "text-emerald-500", label: "Succeeded" },
  failed: { icon: XCircle, color: "text-destructive", label: "Failed" },
  permanent_failure: { icon: AlertTriangle, color: "text-destructive", label: "Permanent Failure" },
  cancelled: { icon: Ban, color: "text-muted-foreground", label: "Cancelled" },
};

export function EventJobRun({ event, timestamp }: Props) {
  const meta = event.metadata as Record<string, unknown>;
  const status = (meta.status as string) || "running";
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.running;
  const Icon = config.icon;
  const jobName = (meta.jobName as string) || "Job";

  return (
    <div className="flex items-center gap-2.5 rounded-md px-3 py-1.5 transition-colors hover:bg-accent/30">
      <Icon className={`size-3.5 shrink-0 ${config.color}`} />
      <span className="min-w-0 flex-1 truncate text-sm">{jobName}</span>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-3xs font-medium ${
        status === "succeeded"
          ? "bg-emerald-500/10 text-emerald-500"
          : status === "failed" || status === "permanent_failure"
            ? "bg-destructive/10 text-destructive"
            : status === "running"
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground"
      }`}>
        {config.label}
      </span>
      <span className="shrink-0 text-3xs text-muted-foreground">{timestamp}</span>
    </div>
  );
}

import { useState, useEffect } from "react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Ban,
  AlertTriangle,
  CalendarClock,
} from "lucide-react";
import { formatDuration, getElapsed } from "@/lib/format";
import type { Run, RunStatus } from "@openorchestra/shared";
import { cn } from "@/lib/utils";

interface StatusConfig {
  bg: string;
  icon: React.ElementType;
  label: string;
}

const bannerConfig: Record<RunStatus, StatusConfig> = {
  deferred: { bg: "bg-blue-500/10", icon: CalendarClock, label: "Scheduled" },
  queued: { bg: "bg-muted", icon: Clock, label: "Queued" },
  running: { bg: "bg-primary/15", icon: Loader2, label: "Running" },
  succeeded: { bg: "bg-success/15", icon: CheckCircle2, label: "Succeeded" },
  failed: { bg: "bg-destructive/15", icon: XCircle, label: "Failed" },
  permanent_failure: {
    bg: "bg-destructive/25",
    icon: AlertTriangle,
    label: "Permanently Failed",
  },
  cancelled: { bg: "bg-muted", icon: Ban, label: "Cancelled" },
};

interface RunStatusBannerProps {
  run: Run;
}

export function RunStatusBanner({ run }: RunStatusBannerProps) {
  const config = bannerConfig[run.status];
  const Icon = config.icon;
  const [elapsed, setElapsed] = useState(
    getElapsed(run.startedAt, run.finishedAt),
  );

  useEffect(() => {
    if (run.status !== "running") {
      setElapsed(getElapsed(run.startedAt, run.finishedAt));
      return;
    }
    const interval = setInterval(() => {
      setElapsed(getElapsed(run.startedAt, null));
    }, 1000);
    return () => clearInterval(interval);
  }, [run.status, run.startedAt, run.finishedAt]);

  return (
    <div className={cn("flex items-center gap-3 px-4 py-3", config.bg)}>
      <Icon
        className={cn(
          "size-5 shrink-0",
          run.status === "running" && "animate-spin text-primary",
          run.status === "succeeded" && "text-success",
          (run.status === "failed" || run.status === "permanent_failure") &&
            "text-destructive",
        )}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{config.label}</span>
          {run.exitCode !== null && run.exitCode !== 0 && (
            <span className="text-xs text-muted-foreground">
              Exit code {run.exitCode}
            </span>
          )}
        </div>
      </div>
      {run.startedAt && (
        <span className="text-sm tabular-nums text-muted-foreground shrink-0">
          {formatDuration(elapsed)}
        </span>
      )}
    </div>
  );
}

import { cn } from "@/lib/utils";
import type { ActiveRun } from "@/hooks/use-active-runs";

interface Props {
  activeRun: ActiveRun;
}

/**
 * Renders a single currently-running or queued job as an inline inbox row,
 * positioned just below the Now divider. Uses the blue pulsing circle indicator.
 */
export function InboxActiveRunRow({ activeRun }: Props) {
  const { run, job } = activeRun;
  const isQueued = run.status === "queued";
  const jobName = job?.name ?? "Running job";

  return (
    <div className="flex items-center gap-2.5 rounded-md px-3 py-2 transition-colors hover:bg-accent/30">
      {/* Pulsing blue circle */}
      <div className="relative shrink-0 mt-0.5">
        <div
          className={cn(
            "size-2 rounded-full",
            isQueued
              ? "bg-primary/40"
              : "bg-primary animate-pulse",
          )}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {jobName}
          </span>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-3xs font-medium",
              isQueued
                ? "bg-muted text-muted-foreground"
                : "bg-primary/10 text-primary",
            )}
          >
            {isQueued ? "Queued" : "Running"}
          </span>
        </div>
        {job?.description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {job.description}
          </p>
        )}
      </div>
    </div>
  );
}

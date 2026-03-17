import { useMemo, useRef, useEffect } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Ban,
  Clock,
  CalendarClock,
  Play,
  RotateCcw,
  ChevronRight,
} from "lucide-react";
import { useRunStore } from "@/stores/run-store";
import { cn } from "@/lib/utils";
import type { Run, RunStatus } from "@openorchestra/shared";

const statusIcon: Record<RunStatus, React.ElementType> = {
  deferred: CalendarClock,
  queued: Clock,
  running: Loader2,
  succeeded: CheckCircle2,
  failed: XCircle,
  permanent_failure: AlertTriangle,
  cancelled: Ban,
};

const statusColor: Record<RunStatus, string> = {
  deferred: "text-blue-400",
  queued: "text-muted-foreground",
  running: "text-primary animate-spin",
  succeeded: "text-success",
  failed: "text-destructive",
  permanent_failure: "text-destructive",
  cancelled: "text-muted-foreground",
};

interface RunChainBreadcrumbProps {
  run: Run;
  onSelectJob: (jobId: string) => void;
  onSelectRun: (runId: string) => void;
}

/** Build the full chain of runs linked by parentRunId */
function buildRunChain(currentRun: Run, allRuns: Run[]): Run[] {
  // Walk up to the root
  let root = currentRun;
  const upVisited = new Set<string>([root.id]);
  while (root.parentRunId) {
    const parent = allRuns.find((r) => r.id === root.parentRunId);
    if (!parent || upVisited.has(parent.id)) break;
    upVisited.add(parent.id);
    root = parent;
  }

  // Walk down from root, following children
  const chain: Run[] = [root];
  const downVisited = new Set<string>([root.id]);
  let current = root;
  for (let i = 0; i < 20; i++) {
    const child = allRuns.find((r) => r.parentRunId === current.id);
    if (!child || downVisited.has(child.id)) break;
    downVisited.add(child.id);
    chain.push(child);
    current = child;
  }

  return chain;
}

export function RunChainBreadcrumb({
  run,
  onSelectJob,
  onSelectRun,
}: RunChainBreadcrumbProps) {
  const { runs } = useRunStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  const chain = useMemo(() => buildRunChain(run, runs), [run, runs]);
  const currentIndex = chain.findIndex((r) => r.id === run.id);

  // Auto-scroll to show the current run's breadcrumb
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const active = container.querySelector("[data-active]");
    if (active) {
      active.scrollIntoView({ inline: "center", block: "nearest" });
    }
  }, [run.id]);

  // Determine trigger label for the first crumb
  const rootRun = chain[0];
  const triggerLabel =
    rootRun.triggerSource === "manual" ? "Manual" : "Scheduled";
  const TriggerIcon =
    rootRun.triggerSource === "manual" ? Play : CalendarClock;

  return (
    <div
      ref={scrollRef}
      className="flex items-center gap-1 overflow-x-auto border-b border-border px-4 py-2 text-xs scrollbar-none"
    >
      {/* Trigger source crumb — links to job */}
      <button
        onClick={() => onSelectJob(run.jobId)}
        className={cn(
          "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 transition-colors",
          "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <TriggerIcon className="size-3" />
        <span>{triggerLabel}</span>
      </button>

      {/* Run crumbs */}
      {chain.map((chainRun, i) => {
        const Icon = chainRun.triggerSource === "corrective"
          ? RotateCcw
          : statusIcon[chainRun.status];
        const isCurrent = chainRun.id === run.id;
        const label = `Run ${chainRun.id.slice(0, 8)}`;

        return (
          <div key={chainRun.id} className="flex shrink-0 items-center gap-1">
            <ChevronRight className="size-3 text-muted-foreground/40" />
            <button
              data-active={isCurrent ? "" : undefined}
              onClick={() => {
                if (!isCurrent) onSelectRun(chainRun.id);
              }}
              className={cn(
                "flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors",
                isCurrent
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon
                className={cn(
                  "size-3",
                  chainRun.triggerSource === "corrective"
                    ? "text-amber-400"
                    : statusColor[chainRun.status],
                )}
              />
              <span>{label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

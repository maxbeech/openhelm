import { Activity, ChevronDown, ChevronUp, RefreshCw, PlayCircle } from "lucide-react";
import { ClaudeUsageWidgets } from "@/components/shared/claude-usage-widgets";
import { ClaudeUsageChart } from "@/components/shared/claude-usage-chart";
import { TokensChart } from "@/components/shared/tokens-chart";
import { RunOutcomesChart } from "@/components/shared/run-outcomes-chart";
import { RunStatusBadge } from "@/components/shared/status-badge";
import { formatTokenCount, formatRelativeTime } from "@/lib/format";
import type { Run, UsageSummary } from "@openhelm/shared";

interface DashboardSystemSectionProps {
  collapsed: boolean;
  onToggle: () => void;
  usageSummary: UsageSummary | null;
  allRuns: Run[];
  recentRuns: Run[];
  hasMoreRuns: boolean;
  jobs: { id: string; name: string; projectId: string }[];
  projects: { id: string; name: string }[];
  activeProjectId: string | null | undefined;
  onSelectRun: (runId: string) => void;
  onRetryRun: (jobId: string, runId: string) => void;
  onNewRun: (jobId: string) => void;
  onLoadMore: () => void;
}

export function DashboardSystemSection({
  collapsed, onToggle, usageSummary, allRuns, recentRuns, hasMoreRuns,
  jobs, projects, activeProjectId, onSelectRun, onRetryRun, onNewRun, onLoadMore,
}: DashboardSystemSectionProps) {
  return (
    <section>
      <div className="sticky top-0 z-10 bg-background flex items-center gap-2.5 border-b border-border px-6 py-3">
        <Activity className="size-5 text-muted-foreground" />
        <h3 className="flex-1 text-base font-semibold">System</h3>
        <button onClick={onToggle} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          {collapsed ? "View more" : "View less"}
          {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
        </button>
      </div>

      {collapsed ? (
        <div className="px-6 py-3 animate-in fade-in duration-200">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Run Outcomes (14 days)</p>
          <RunOutcomesChart runs={allRuns} />
        </div>
      ) : (
        <div className="space-y-8 px-6 pt-3 pb-1 animate-in fade-in slide-in-from-top-1 duration-300">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Run Outcomes (14 days)</p>
            <RunOutcomesChart runs={allRuns} />
          </div>
          <div>
            <h4 className="mb-3 text-xs font-semibold text-muted-foreground">Recent Runs</h4>
            {recentRuns.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No runs yet.</p>
            ) : (
              <div className="overflow-x-auto -mx-6 px-6">
              <div className="space-y-1 min-w-[280px]">
                {recentRuns.map((run) => (
                  <RecentRunRow key={run.id} run={run} jobs={jobs} projects={projects}
                    onSelect={() => onSelectRun(run.id)}
                    onRetry={() => onRetryRun(run.jobId, run.id)}
                    onNewRun={() => onNewRun(run.jobId)} />
                ))}
                {hasMoreRuns && (
                  <button className="flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    onClick={onLoadMore}>
                    <ChevronDown className="size-3.5" /> View more
                  </button>
                )}
              </div>
              </div>
            )}
          </div>
          {usageSummary && (
            <div>
              <h4 className="mb-3 text-xs font-semibold text-muted-foreground">Claude Code Usage</h4>
              <ClaudeUsageWidgets summary={usageSummary} />
              <ClaudeUsageChart
                series={usageSummary.series}
                dailyBudget={usageSummary.dailyBudget}
                weeklyBudget={usageSummary.weeklyBudget}
                weekOnly
                className="mt-3"
              />
            </div>
          )}
          <div>
            <h4 className="mb-3 text-xs font-semibold text-muted-foreground">Token Usage</h4>
            <TokensChart projectId={activeProjectId ?? undefined} />
          </div>
        </div>
      )}
    </section>
  );
}

function RecentRunRow({ run, jobs, projects, onSelect, onRetry, onNewRun }: {
  run: Run;
  jobs: { id: string; name: string; projectId: string }[];
  projects: { id: string; name: string }[];
  onSelect: () => void; onRetry: () => void; onNewRun: () => void;
}) {
  const job = jobs.find((j) => j.id === run.jobId);
  const project = job ? projects.find((p) => p.id === job.projectId) : null;
  const isFailed = run.status === "failed" || run.status === "permanent_failure";
  const isTerminal = ["succeeded", "failed", "permanent_failure", "cancelled"].includes(run.status);
  return (
    <div className="group relative flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent">
      <button onClick={onSelect} className="min-w-0 flex-1 text-left">
        <span className="truncate font-medium">{job?.name ?? "Unknown Job"}</span>
        {project && <span className="ml-1 text-2xs text-muted-foreground">{project.name}</span>}
      </button>
      <RunStatusBadge status={run.status} />
      {(run.inputTokens != null || run.outputTokens != null) && (
        <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground hidden [@media(min-width:320px)]:inline">
          {formatTokenCount((run.inputTokens ?? 0) + (run.outputTokens ?? 0))}
        </span>
      )}
      <span className="shrink-0 text-2xs text-muted-foreground">{formatRelativeTime(run.createdAt)}</span>
      {isTerminal && (
        <div className="absolute right-2 hidden items-center gap-1 group-hover:flex bg-accent rounded">
          {isFailed && (
            <button onClick={(e) => { e.stopPropagation(); onRetry(); }}
              className="flex h-6 items-center gap-1 rounded px-1.5 text-2xs text-destructive transition-colors hover:bg-background hover:text-destructive">
              <RefreshCw className="size-3" /> Retry
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onNewRun(); }}
            className="flex h-6 items-center gap-1 rounded px-1.5 text-2xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground">
            <PlayCircle className="size-3" /> Run
          </button>
        </div>
      )}
    </div>
  );
}

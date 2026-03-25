import { useMemo, useState, useEffect, useCallback } from "react";
import { Target, Briefcase, Play, AlertTriangle, Inbox, ChevronDown, ChevronUp, RotateCcw, Bot, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInboxStore } from "@/stores/inbox-store";
import { useGoalStore } from "@/stores/goal-store";
import { useJobStore } from "@/stores/job-store";
import { useRunStore } from "@/stores/run-store";
import { useProjectStore } from "@/stores/project-store";
import { useAppStore } from "@/stores/app-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RunStatusBadge } from "@/components/shared/status-badge";
import { TokensChart } from "@/components/shared/tokens-chart";
import { AlertGroup } from "./alert-group";
import { formatTokenCount } from "@/lib/format";
import * as api from "@/lib/api";
import type { InboxItem, Run, AutopilotProposal } from "@openhelm/shared";

const DEFAULT_VISIBLE_GROUPS = 3;

export function InboxView() {
  const { items, loading, dismissAll } = useInboxStore();
  const { goals } = useGoalStore();
  const { jobs } = useJobStore();
  const { runs } = useRunStore();
  const { projects } = useProjectStore();
  const { selectRunPreserveView, activeProjectId } = useAppStore();
  const { triggerRun } = useRunStore();
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [dismissingAll, setDismissingAll] = useState(false);
  const [proposals, setProposals] = useState<AutopilotProposal[]>([]);

  const fetchProposals = useCallback(async () => {
    try {
      const list = await api.listAutopilotProposals({ status: "pending" });
      setProposals(list);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchProposals(); }, [fetchProposals]);

  const handleApproveProposal = async (id: string) => {
    try {
      await api.approveAutopilotProposal({ id });
      setProposals((p) => p.filter((pr) => pr.id !== id));
    } catch { /* ignore */ }
  };

  const handleRejectProposal = async (id: string) => {
    try {
      await api.rejectAutopilotProposal(id);
      setProposals((p) => p.filter((pr) => pr.id !== id));
    } catch { /* ignore */ }
  };

  const activeGoalCount = useMemo(
    () => goals.filter((g) => g.status === "active").length,
    [goals],
  );
  const enabledJobCount = useMemo(
    () => jobs.filter((j) => j.isEnabled).length,
    [jobs],
  );
  const { runningCount, recentSuccessCount } = useMemo(() => {
    const running = runs.filter((r) => r.status === "running").length;
    const recentSuccess = runs
      .slice(0, 10)
      .filter((r) => r.status === "succeeded").length;
    return { runningCount: running, recentSuccessCount: recentSuccess };
  }, [runs]);

  // Recent runs: last 15, across all projects
  const recentRuns = useMemo(() => runs.slice(0, 15), [runs]);

  // Group items by jobId, sorted by most recent alert in each group
  const alertGroups = useMemo(() => {
    const groupMap = new Map<string, InboxItem[]>();
    for (const item of items) {
      const group = groupMap.get(item.jobId) ?? [];
      group.push(item);
      groupMap.set(item.jobId, group);
    }
    return Array.from(groupMap.entries())
      .map(([jobId, groupItems]) => ({ jobId, items: groupItems }))
      .sort((a, b) => {
        const aTime = new Date(a.items[0].createdAt).getTime();
        const bTime = new Date(b.items[0].createdAt).getTime();
        return bTime - aTime;
      });
  }, [items]);

  const visibleGroups = showAllAlerts
    ? alertGroups
    : alertGroups.slice(0, DEFAULT_VISIBLE_GROUPS);
  const hiddenGroupCount = alertGroups.length - DEFAULT_VISIBLE_GROUPS;

  const handleDismissAll = async () => {
    setDismissingAll(true);
    try {
      await dismissAll();
    } finally {
      setDismissingAll(false);
    }
  };

  return (
    <div className="space-y-8 px-6 pt-14 pb-8">
      {/* Overview stats */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
          Overview
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            icon={Target}
            label="Active Goals"
            value={activeGoalCount}
          />
          <StatCard
            icon={Briefcase}
            label="Enabled Jobs"
            value={enabledJobCount}
          />
          <StatCard
            icon={Play}
            label={runningCount > 0 ? "Running Now" : "Recent Successes"}
            value={runningCount > 0 ? runningCount : recentSuccessCount}
            highlight={runningCount > 0}
          />
        </div>
      </section>

      {/* Autopilot Proposals */}
      {proposals.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-primary" />
            <h3 className="text-sm font-semibold text-muted-foreground">Proposed System Jobs</h3>
            <Badge className="ml-1 text-[10px]">{proposals.length}</Badge>
          </div>
          {proposals.map((proposal) => {
            const goal = goals.find((g) => g.id === proposal.goalId);
            return (
              <div key={proposal.id} className="rounded-lg border border-border p-3">
                <p className="mb-2 text-sm font-medium">
                  {goal?.name ?? "Unknown Goal"}
                </p>
                <ul className="mb-3 space-y-1">
                  {proposal.plannedJobs.map((sj, i) => (
                    <li key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Bot className="size-3 shrink-0" />
                      {sj.name}
                      <span className="rounded bg-muted px-1 py-0.5 text-[10px]">{sj.systemCategory}</span>
                    </li>
                  ))}
                </ul>
                <p className="mb-3 text-xs text-muted-foreground">{proposal.reason}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="default" className="h-7 gap-1 text-xs" onClick={() => handleApproveProposal(proposal.id)}>
                    <Check className="size-3" />
                    Approve
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => handleRejectProposal(proposal.id)}>
                    <X className="size-3" />
                    Dismiss
                  </Button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Alerts section — always visible, cross-project */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle
            className={cn(
              "size-4",
              items.length > 0 ? "text-destructive" : "text-muted-foreground/50",
            )}
          />
          <h3 className="text-sm font-semibold text-muted-foreground">Needs Attention</h3>
          {items.length > 0 && (
            <Badge variant="destructive" className="ml-1 text-[10px]">
              {items.length}
            </Badge>
          )}
          {items.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              disabled={dismissingAll || loading}
              onClick={handleDismissAll}
            >
              Dismiss all
            </Button>
          )}
        </div>
        {alertGroups.length > 0 ? (
          <div className="space-y-3">
            {visibleGroups.map((group) => (
              <AlertGroup key={group.jobId} jobId={group.jobId} items={group.items} />
            ))}
            {alertGroups.length > DEFAULT_VISIBLE_GROUPS && (
              <button
                className="flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setShowAllAlerts((v) => !v)}
              >
                {showAllAlerts ? (
                  <>
                    <ChevronUp className="size-3.5" />
                    Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="size-3.5" />
                    {hiddenGroupCount} more job{hiddenGroupCount !== 1 ? "s" : ""}
                  </>
                )}
              </button>
            )}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
            No alerts — everything looks good.
          </p>
        )}
      </section>

      {/* Recent runs */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
          Recent Runs
        </h3>
        {recentRuns.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No runs yet. Create a job to get started.
          </p>
        ) : (
          <div className="space-y-1">
            {recentRuns.map((run) => (
              <RecentRunRow
                key={run.id}
                run={run}
                jobs={jobs}
                projects={projects}
                onSelect={() => selectRunPreserveView(run.id)}
                onRerun={() => triggerRun(run.jobId)}
                onFreshRun={() => triggerRun(run.jobId)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Token Usage chart */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Token Usage</h3>
        <TokensChart projectId={activeProjectId ?? undefined} />
      </section>

      {/* Empty state when everything is clear and nothing to show */}
      {items.length === 0 && recentRuns.length === 0 && (
        <div className="py-8 text-center">
          <Inbox className="mx-auto mb-3 size-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            All clear — no alerts or activity yet.
          </p>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <Icon
          className={`size-3.5 ${highlight ? "text-primary" : "text-muted-foreground"}`}
        />
        <span className="text-xl font-bold">{value}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function RecentRunRow({
  run,
  jobs,
  projects,
  onSelect,
  onRerun,
  onFreshRun,
}: {
  run: Run;
  jobs: { id: string; name: string; projectId: string }[];
  projects: { id: string; name: string }[];
  onSelect: () => void;
  onRerun: () => void;
  onFreshRun: () => void;
}) {
  const job = jobs.find((j) => j.id === run.jobId);
  const project = job ? projects.find((p) => p.id === job.projectId) : null;
  const timeAgo = formatRelativeTime(run.createdAt);

  return (
    <div className="group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent">
      <button
        onClick={onSelect}
        className="min-w-0 flex-1 text-left"
      >
        <span className="truncate font-medium">
          {job?.name ?? "Unknown Job"}
        </span>
        {project && (
          <span className="ml-2 text-[11px] text-muted-foreground">
            {project.name}
          </span>
        )}
      </button>
      {/* Hover action CTAs */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={(e) => { e.stopPropagation(); onRerun(); }}
          title="Retry — pick up where it left off"
          className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <RotateCcw className="size-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onFreshRun(); }}
          title="Fresh run"
          className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <Play className="size-3.5" />
        </button>
      </div>
      <RunStatusBadge status={run.status} />
      {(run.inputTokens != null || run.outputTokens != null) && (
        <span className="shrink-0 text-[11px] text-muted-foreground font-mono tabular-nums">
          {formatTokenCount((run.inputTokens ?? 0) + (run.outputTokens ?? 0))}
        </span>
      )}
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {timeAgo}
      </span>
    </div>
  );
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

import { Target, Briefcase, Play, AlertTriangle, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInboxStore } from "@/stores/inbox-store";
import { useGoalStore } from "@/stores/goal-store";
import { useJobStore } from "@/stores/job-store";
import { useRunStore } from "@/stores/run-store";
import { useProjectStore } from "@/stores/project-store";
import { useAppStore } from "@/stores/app-store";
import { Badge } from "@/components/ui/badge";
import { RunStatusBadge } from "@/components/shared/status-badge";
import { InboxCard } from "./inbox-card";
import type { Run } from "@openorchestra/shared";

export function InboxView() {
  const { items, loading } = useInboxStore();
  const { goals } = useGoalStore();
  const { jobs } = useJobStore();
  const { runs } = useRunStore();
  const { projects } = useProjectStore();
  const { selectRun } = useAppStore();

  const activeGoalCount = goals.filter((g) => g.status === "active").length;
  const enabledJobCount = jobs.filter((j) => j.isEnabled).length;
  const runningCount = runs.filter((r) => r.status === "running").length;
  const recentSuccessCount = runs
    .slice(0, 10)
    .filter((r) => r.status === "succeeded").length;

  // Recent runs: last 15, across all projects
  const recentRuns = runs.slice(0, 15);

  return (
    <div className="space-y-8 px-6 py-8">
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
        </div>
        {items.length > 0 ? (
          <div className="space-y-3">
            {items.map((item) => (
              <InboxCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
            No alerts — everything looks good.
          </p>
        )}
      </section>

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
                onSelect={() => selectRun(run.id, run.jobId)}
              />
            ))}
          </div>
        )}
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
}: {
  run: Run;
  jobs: { id: string; name: string; projectId: string }[];
  projects: { id: string; name: string }[];
  onSelect: () => void;
}) {
  const job = jobs.find((j) => j.id === run.jobId);
  const project = job ? projects.find((p) => p.id === job.projectId) : null;
  const timeAgo = formatRelativeTime(run.createdAt);

  return (
    <button
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
    >
      <div className="min-w-0 flex-1">
        <span className="truncate font-medium">
          {job?.name ?? "Unknown Job"}
        </span>
        {project && (
          <span className="ml-2 text-[11px] text-muted-foreground">
            {project.name}
          </span>
        )}
      </div>
      <RunStatusBadge status={run.status} />
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {timeAgo}
      </span>
    </button>
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

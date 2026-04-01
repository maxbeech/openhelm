import { Target, Briefcase, Play } from "lucide-react";
import { useGoalStore } from "@/stores/goal-store";
import { useJobStore } from "@/stores/job-store";
import { useRunStore } from "@/stores/run-store";

export function HomeView() {
  const { goals } = useGoalStore();
  const { jobs } = useJobStore();
  const { runs } = useRunStore();

  const activeGoalCount = goals.filter((g) => g.status === "active").length;
  const enabledJobCount = jobs.filter((j) => j.isEnabled).length;
  const runningCount = runs.filter((r) => r.status === "running").length;
  const recentSuccessCount = runs
    .slice(0, 10)
    .filter((r) => r.status === "succeeded").length;

  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <h2 className="mb-6 text-lg font-semibold">Overview</h2>
      <div className="grid grid-cols-3 gap-4 min-w-0">
        <StatCard icon={Target} label="Active Goals" value={activeGoalCount} />
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
    <div className="min-w-0 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 min-w-0">
        <Icon
          className={`shrink-0 size-4 ${highlight ? "text-primary" : "text-muted-foreground"}`}
        />
        <span className="text-2xl font-bold truncate">{value}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground truncate">{label}</p>
    </div>
  );
}

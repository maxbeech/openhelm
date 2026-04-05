import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { Target, Briefcase, Play } from "lucide-react";
import { useGoalStore } from "@/stores/goal-store";
import { useJobStore } from "@/stores/job-store";
import { useRunStore } from "@/stores/run-store";
import { useProjectStore } from "@/stores/project-store";
import { useAppStore } from "@/stores/app-store";
import { DashboardSystemSection } from "./dashboard-system-section";
import { DashboardInsightsSection } from "./dashboard-insights-section";
import { useAgentEvent } from "@/hooks/use-agent-event";
import * as api from "@/lib/api";
import type { UsageSummary } from "@openhelm/shared";

export function DashboardView() {
  const { goals } = useGoalStore();
  const { jobs } = useJobStore();
  const { runs } = useRunStore();
  const { projects } = useProjectStore();
  const { selectRunPreserveView, activeProjectId } = useAppStore();
  const { triggerRun, retryRun } = useRunStore();

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [visibleRunCount, setVisibleRunCount] = useState(10);
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const fetchUsageRef = useRef<() => void>(null!);

  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // Data fetching
  const fetchUsage = useCallback(async () => {
    try { setUsageSummary(await api.getUsageSummary()); } catch { /* non-fatal */ }
  }, []);
  fetchUsageRef.current = fetchUsage;
  useEffect(() => { fetchUsage(); }, [fetchUsage]);
  useAgentEvent("usage.updated", useCallback(() => fetchUsageRef.current(), []));
  useAgentEvent("run.statusChanged", useCallback((data: { status: string }) => {
    if (["succeeded", "failed", "permanent_failure", "cancelled"].includes(data.status)) fetchUsageRef.current();
  }, []));

  // (Alerts & Actions section moved to Inbox page)

  // Computed
  const activeGoalCount = useMemo(() => goals.filter((g) => g.status === "active").length, [goals]);
  const enabledJobCount = useMemo(() => jobs.filter((j) => j.isEnabled).length, [jobs]);
  const { runningCount, recentSuccessCount } = useMemo(() => ({
    runningCount: runs.filter((r) => r.status === "running").length,
    recentSuccessCount: runs.slice(0, 10).filter((r) => r.status === "succeeded").length,
  }), [runs]);


  return (
    <div className="pt-4 pb-8 overflow-x-hidden">
      {/* Overview stats */}
      <section className="px-6 mb-6">
        <motion.div
          className="grid grid-cols-3 gap-3 min-w-0"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={staggerItem}>
            <StatCard icon={Target} label="Active Goals" value={activeGoalCount} />
          </motion.div>
          <motion.div variants={staggerItem}>
            <StatCard icon={Briefcase} label="Enabled Jobs" value={enabledJobCount} />
          </motion.div>
          <motion.div variants={staggerItem}>
            <StatCard icon={Play}
              label={runningCount > 0 ? "Running Now" : "Recent Successes"}
              value={runningCount > 0 ? runningCount : recentSuccessCount}
              highlight={runningCount > 0} />
          </motion.div>
        </motion.div>
      </section>

      {/* System */}
      <DashboardSystemSection
        collapsed={!expanded.system} onToggle={() => toggle("system")}
        usageSummary={usageSummary} allRuns={runs}
        recentRuns={runs.slice(0, visibleRunCount)} hasMoreRuns={runs.length > visibleRunCount}
        jobs={jobs} projects={projects} activeProjectId={activeProjectId}
        onSelectRun={selectRunPreserveView} onRetryRun={retryRun} onNewRun={triggerRun}
        onLoadMore={() => setVisibleRunCount((v) => v + 10)}
      />

      {/* Insights */}
      <DashboardInsightsSection
        collapsed={!expanded.insights}
        onToggle={() => toggle("insights")}
      />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, highlight }: {
  icon: React.ElementType; label: string; value: number; highlight?: boolean;
}) {
  return (
    <div className="hover-lift min-w-0 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className={`shrink-0 size-3.5 ${highlight ? "text-primary" : "text-muted-foreground"}`} />
        <span className="text-xl font-bold truncate">{value}</span>
      </div>
      <p className="mt-0.5 text-2xs text-muted-foreground truncate">{label}</p>
    </div>
  );
}

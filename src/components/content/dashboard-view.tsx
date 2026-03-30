import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Target, Briefcase, Play } from "lucide-react";
import { useDashboardStore } from "@/stores/dashboard-store";
import { useGoalStore } from "@/stores/goal-store";
import { useJobStore } from "@/stores/job-store";
import { useRunStore } from "@/stores/run-store";
import { useProjectStore } from "@/stores/project-store";
import { useAppStore } from "@/stores/app-store";
import { useVisualizationStore } from "@/stores/visualization-store";
import { DashboardAlertsSection } from "./dashboard-alerts-section";
import { DashboardSystemSection } from "./dashboard-system-section";
import { DashboardInsightsSection } from "./dashboard-insights-section";
import { useAgentEvent } from "@/hooks/use-agent-event";
import * as api from "@/lib/api";
import type { DashboardItem, AutopilotProposal, UsageSummary, Visualization } from "@openhelm/shared";

export function DashboardView() {
  const { items, loading, dismissAll } = useDashboardStore();
  const { goals } = useGoalStore();
  const { jobs } = useJobStore();
  const { runs } = useRunStore();
  const { projects } = useProjectStore();
  const { selectRunPreserveView, activeProjectId } = useAppStore();
  const { triggerRun, retryRun } = useRunStore();

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [dismissingAll, setDismissingAll] = useState(false);
  const [visibleRunCount, setVisibleRunCount] = useState(10);
  const [proposals, setProposals] = useState<AutopilotProposal[]>([]);
  const [suggestedVizs, setSuggestedVizs] = useState<Visualization[]>([]);
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

  const fetchProposals = useCallback(async () => {
    try { setProposals(await api.listAutopilotProposals({ status: "pending" })); } catch { /* ignore */ }
  }, []);
  useEffect(() => { fetchProposals(); }, [fetchProposals]);

  const fetchSuggested = useCallback(async () => {
    try { setSuggestedVizs(await api.listVisualizations({ status: "suggested" })); } catch { /* ignore */ }
  }, []);
  useEffect(() => { fetchSuggested(); }, [fetchSuggested]);
  useAgentEvent("visualization.suggested", fetchSuggested);
  useAgentEvent("visualization.updated", fetchSuggested);

  // Handlers
  const handleApprove = async (id: string) => { try { await api.approveAutopilotProposal({ id }); setProposals((p) => p.filter((x) => x.id !== id)); } catch {} };
  const handleReject = async (id: string) => { try { await api.rejectAutopilotProposal(id); setProposals((p) => p.filter((x) => x.id !== id)); } catch {} };
  const handleAcceptViz = async (id: string) => { try { await api.acceptVisualization(id); setSuggestedVizs((v) => v.filter((x) => x.id !== id)); } catch {} };
  const handleDismissViz = async (id: string) => { try { await api.dismissVisualization(id); setSuggestedVizs((v) => v.filter((x) => x.id !== id)); } catch {} };
  const handleDismissAll = async () => { setDismissingAll(true); try { await dismissAll(); } finally { setDismissingAll(false); } };

  // Computed
  const activeGoalCount = useMemo(() => goals.filter((g) => g.status === "active").length, [goals]);
  const enabledJobCount = useMemo(() => jobs.filter((j) => j.isEnabled).length, [jobs]);
  const { runningCount, recentSuccessCount } = useMemo(() => ({
    runningCount: runs.filter((r) => r.status === "running").length,
    recentSuccessCount: runs.slice(0, 10).filter((r) => r.status === "succeeded").length,
  }), [runs]);

  const alertGroups = useMemo(() => {
    const map = new Map<string, DashboardItem[]>();
    for (const item of items) { const g = map.get(item.jobId) ?? []; g.push(item); map.set(item.jobId, g); }
    return Array.from(map.entries())
      .map(([jobId, groupItems]) => ({ jobId, items: groupItems }))
      .sort((a, b) => new Date(b.items[0].createdAt).getTime() - new Date(a.items[0].createdAt).getTime());
  }, [items]);

  const alertCount = items.length + proposals.length + suggestedVizs.length;

  return (
    <div className="pt-4 pb-8">
      {/* Overview stats */}
      <section className="px-6 mb-6">
        <div className="grid grid-cols-3 gap-3">
          <StatCard icon={Target} label="Active Goals" value={activeGoalCount} />
          <StatCard icon={Briefcase} label="Enabled Jobs" value={enabledJobCount} />
          <StatCard icon={Play}
            label={runningCount > 0 ? "Running Now" : "Recent Successes"}
            value={runningCount > 0 ? runningCount : recentSuccessCount}
            highlight={runningCount > 0} />
        </div>
      </section>

      {/* Alerts & Actions */}
      <DashboardAlertsSection
        collapsed={!expanded.alerts} onToggle={() => toggle("alerts")}
        proposals={proposals} suggestedVizs={suggestedVizs} alertGroups={alertGroups}
        goals={goals} loading={loading} dismissingAll={dismissingAll} showAllAlerts={showAllAlerts}
        alertCount={alertCount} onApproveProposal={handleApprove} onRejectProposal={handleReject}
        onAcceptViz={handleAcceptViz} onDismissViz={handleDismissViz} onDismissAll={handleDismissAll}
        onToggleShowAll={() => setShowAllAlerts((v) => !v)}
      />

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
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <Icon className={`size-3.5 ${highlight ? "text-primary" : "text-muted-foreground"}`} />
        <span className="text-xl font-bold">{value}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from "react";
import { getJobTokenStats } from "@/lib/api";
import { formatTokenCount } from "@/lib/format";
import { useAgentEvent } from "@/hooks/use-agent-event";
import type { JobTokenStat } from "@openhelm/shared";
import { cn } from "@/lib/utils";

type Mode = "total" | "avg";
type Period = "12h" | "1d" | "7d" | "30d" | "90d" | "all";

interface TokensChartProps {
  /** Scope to a specific project */
  projectId?: string;
  /** Scope to specific jobs (e.g. single job in job detail) */
  jobIds?: string[];
  /** Compact mode: smaller padding/text for narrow panels */
  compact?: boolean;
}

// Values in hours; null means "all time"
const PERIOD_HOURS: Record<Period, number | null> = {
  "12h": 12,
  "1d": 24,
  "7d": 7 * 24,
  "30d": 30 * 24,
  "90d": 90 * 24,
  "all": null,
};

function periodToFrom(period: Period): string | undefined {
  const hours = PERIOD_HOURS[period];
  if (hours == null) return undefined;
  const d = new Date();
  d.setTime(d.getTime() - hours * 60 * 60 * 1000);
  return d.toISOString();
}

const BAR_COLORS = [
  "bg-blue-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-pink-500",
];

export function TokensChart({ projectId, jobIds, compact = false }: TokensChartProps) {
  const [mode, setMode] = useState<Mode>("avg");
  const [period, setPeriod] = useState<Period>("30d");
  const [stats, setStats] = useState<JobTokenStat[]>([]);
  const [loading, setLoading] = useState(true);
  // Stable ref so the event handler never re-subscribes
  const fetchRef = useRef<() => void>(null!);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const from = periodToFrom(period);
      const data = await getJobTokenStats({ projectId, jobIds, from });
      setStats(data);
    } catch {
      setStats([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, jobIds, period]);

  // Keep ref in sync so the event handler always calls the latest version
  fetchRef.current = fetchStats;

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Refresh whenever a run reaches a terminal state (tokens are only recorded then)
  const handleRunStatusChanged = useCallback((data: { status: string }) => {
    const terminal = ["succeeded", "failed", "permanent_failure", "cancelled"];
    if (terminal.includes(data.status)) {
      fetchRef.current();
    }
  }, []);

  useAgentEvent("run.statusChanged", handleRunStatusChanged);

  const getValue = (stat: JobTokenStat): number => {
    const total = stat.totalInputTokens + stat.totalOutputTokens;
    if (mode === "total") return total;
    return stat.runCount > 0 ? Math.round(total / stat.runCount) : 0;
  };

  const sortedStats = [...stats].sort((a, b) => getValue(b) - getValue(a));
  const maxValue = sortedStats.length > 0 ? Math.max(...sortedStats.map(getValue), 1) : 1;
  const hasData = sortedStats.some((s) => getValue(s) > 0);

  return (
    <div className={cn("rounded-lg border border-border bg-card", compact ? "p-3" : "p-4")}>
      {/* Controls */}
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        {/* Mode toggle */}
        <div className="flex items-center rounded-md border border-border text-[11px]">
          <button
            onClick={() => setMode("avg")}
            className={cn(
              "rounded-l-md px-2 py-1 transition-colors",
              mode === "avg"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Avg/Run
          </button>
          <button
            onClick={() => setMode("total")}
            className={cn(
              "rounded-r-md px-2 py-1 transition-colors",
              mode === "total"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Total
          </button>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Period toggle */}
        <div className="flex items-center rounded-md border border-border text-[11px]">
          {(["12h", "1d", "7d", "30d", "90d", "all"] as Period[]).map((p, i, arr) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-2 py-1 transition-colors",
                i === 0 && "rounded-l-md",
                i === arr.length - 1 && "rounded-r-md",
                period === p
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p === "all" ? "All" : p === "1d" ? "1d" : p}
            </button>
          ))}
        </div>
      </div>

      {/* Chart body */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-20 h-3 rounded bg-muted animate-pulse" />
              <div
                className="h-4 rounded bg-muted animate-pulse"
                style={{ width: `${(4 - i) * 20 + 20}%` }}
              />
            </div>
          ))}
        </div>
      ) : !hasData ? (
        <p className={cn("text-center text-muted-foreground", compact ? "text-[11px] py-3" : "text-xs py-4")}>
          No token data yet — runs will appear here.
        </p>
      ) : (
        <div className="space-y-2">
          {sortedStats.map((stat, i) => {
            const value = getValue(stat);
            const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
            const color = BAR_COLORS[i % BAR_COLORS.length];
            const label =
              stat.jobName.length > 22
                ? stat.jobName.slice(0, 21) + "…"
                : stat.jobName;

            return (
              <div key={stat.jobId} className="flex items-center gap-2">
                <span
                  className={cn(
                    "shrink-0 text-right text-muted-foreground truncate",
                    compact ? "text-[10px] w-16" : "text-[11px] w-20",
                  )}
                  title={stat.jobName}
                >
                  {label}
                </span>
                <div className="flex flex-1 items-center gap-2 min-w-0">
                  <div className="flex-1 rounded bg-muted/40 overflow-hidden" style={{ height: compact ? 12 : 14 }}>
                    <div
                      className={cn("h-full rounded transition-all duration-300", color)}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span
                    className={cn(
                      "shrink-0 font-mono text-foreground tabular-nums",
                      compact ? "text-[10px] w-10" : "text-[11px] w-12",
                    )}
                  >
                    {formatTokenCount(value)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getRunToolStats } from "@/lib/api";
import { formatTokenCount } from "@/lib/format";
import { useAgentEvent } from "@/hooks/use-agent-event";
import { useRunStore } from "@/stores/run-store";
import type { RunToolStat } from "@openhelm/shared";
import { cn } from "@/lib/utils";

type Mode = "invocations" | "tokens";
type Period = "12h" | "1d" | "7d" | "30d" | "90d" | "all";

interface ToolUsageChartProps {
  projectId?: string;
  jobIds?: string[];
  compact?: boolean;
}

const PERIOD_HOURS: Record<Period, number | null> = {
  "12h": 12, "1d": 24, "7d": 7 * 24, "30d": 30 * 24, "90d": 90 * 24, "all": null,
};

function periodToFrom(period: Period): string | undefined {
  const hours = PERIOD_HOURS[period];
  if (hours == null) return undefined;
  const d = new Date();
  d.setTime(d.getTime() - hours * 60 * 60 * 1000);
  return d.toISOString();
}

const BAR_COLORS = [
  "bg-blue-500", "bg-violet-500", "bg-emerald-500", "bg-amber-500",
  "bg-rose-500", "bg-cyan-500", "bg-orange-500", "bg-pink-500",
];

/** Shorten MCP-style tool names for readability */
function shortenToolName(name: string): string {
  if (name === "__reasoning__") return "Reasoning";
  // mcp__openhelm_browser__navigate → browser:navigate
  // mcp__openhelm-browser__navigate → browser:navigate (legacy, historical stats)
  // Lazy-match the server name up to the first `__` delimiter.
  const mcpMatch = name.match(/^mcp__(.+?)__(.+)$/);
  if (mcpMatch) {
    const server = mcpMatch[1].replace(/^openhelm[-_]/, "");
    return `${server}:${mcpMatch[2]}`;
  }
  // Built-in tools like Read, Write, Bash — keep as-is
  return name;
}

export function ToolUsageChart({ projectId, jobIds, compact = false }: ToolUsageChartProps) {
  const { runs } = useRunStore();
  const [mode, setMode] = useState<Mode>("invocations");
  const [period, setPeriod] = useState<Period>("all");
  const [stats, setStats] = useState<RunToolStat[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef<() => void>(null!);

  const supportedPeriods = useMemo(() => {
    const set = new Set<Period>(["all"]);
    const relevantRuns = jobIds ? runs.filter((r) => jobIds.includes(r.jobId)) : runs;
    for (const [p, hours] of Object.entries(PERIOD_HOURS) as [Period, number | null][]) {
      if (hours == null) continue;
      const from = new Date(Date.now() - hours * 60 * 60 * 1000);
      if (relevantRuns.some((r) => new Date(r.createdAt) >= from)) set.add(p);
    }
    return set;
  }, [runs, jobIds]);

  useEffect(() => {
    if (!supportedPeriods.has(period)) setPeriod("all");
  }, [supportedPeriods, period]);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const from = periodToFrom(period);
      const data = await getRunToolStats({ projectId, jobIds, from });
      setStats(data);
    } catch {
      setStats([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, jobIds, period]);

  fetchRef.current = fetchStats;

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleRunStatusChanged = useCallback((data: { status: string }) => {
    const terminal = ["succeeded", "failed", "permanent_failure", "cancelled"];
    if (terminal.includes(data.status)) fetchRef.current();
  }, []);

  useAgentEvent("run.statusChanged", handleRunStatusChanged);

  const getValue = (stat: RunToolStat): number =>
    mode === "invocations" ? stat.invocations : stat.approxOutputTokens;

  const sortedStats = [...stats].sort((a, b) => getValue(b) - getValue(a));
  const maxValue = sortedStats.length > 0 ? Math.max(...sortedStats.map(getValue), 1) : 1;
  const hasData = sortedStats.some((s) => getValue(s) > 0);

  return (
    <div className={cn("rounded-lg border border-border bg-card", compact ? "p-3" : "p-4")}>
      {/* Controls */}
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <div className="flex items-center rounded-md border border-border text-2xs">
          <button
            onClick={() => setMode("invocations")}
            className={cn(
              "rounded-l-md px-2 py-1 transition-colors",
              mode === "invocations"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Calls
          </button>
          <button
            onClick={() => setMode("tokens")}
            className={cn(
              "rounded-r-md px-2 py-1 transition-colors",
              mode === "tokens"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Output Tokens
          </button>
        </div>

        {mode === "tokens" && (
          <span className="text-3xs text-muted-foreground italic">approx.</span>
        )}

        <div className="flex-1" />

        <div className="flex items-center rounded-md border border-border text-2xs">
          {(["12h", "1d", "7d", "30d", "90d", "all"] as Period[]).map((p, i, arr) => {
            const isSupported = supportedPeriods.has(p);
            return (
              <button
                key={p}
                onClick={() => isSupported && setPeriod(p)}
                disabled={!isSupported}
                className={cn(
                  "px-2 py-1 transition-colors",
                  i === 0 && "rounded-l-md",
                  i === arr.length - 1 && "rounded-r-md",
                  !isSupported && "opacity-30 cursor-not-allowed",
                  period === p
                    ? "bg-primary text-primary-foreground"
                    : isSupported
                      ? "text-muted-foreground hover:text-foreground"
                      : "text-muted-foreground",
                )}
              >
                {p === "all" ? "All" : p}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart body */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-20 h-3 rounded bg-muted animate-pulse" />
              <div className="h-4 rounded bg-muted animate-pulse" style={{ width: `${(4 - i) * 20 + 20}%` }} />
            </div>
          ))}
        </div>
      ) : !hasData ? (
        <p className={cn("text-center text-muted-foreground", compact ? "text-2xs py-3" : "text-xs py-4")}>
          No tool usage data yet — runs will appear here.
        </p>
      ) : (
        <div className="space-y-2">
          {sortedStats.map((stat, i) => {
            const value = getValue(stat);
            if (value === 0) return null;
            const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
            const color = stat.toolName === "__reasoning__"
              ? "bg-muted-foreground/50"
              : BAR_COLORS[i % BAR_COLORS.length];
            const label = shortenToolName(stat.toolName);
            const truncLabel = label.length > 24 ? label.slice(0, 23) + "\u2026" : label;

            return (
              <div key={stat.toolName} className="flex items-center gap-2 px-1 -mx-1">
                <span
                  className={cn(
                    "shrink-0 text-right text-muted-foreground truncate",
                    compact ? "text-3xs w-20" : "text-2xs w-24",
                  )}
                  title={stat.toolName}
                >
                  {truncLabel}
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
                      compact ? "text-3xs w-10" : "text-2xs w-12",
                    )}
                  >
                    {mode === "tokens" ? formatTokenCount(value) : value.toLocaleString()}
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

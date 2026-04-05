import { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { formatTokenCount } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { UsageDayPoint } from "@openhelm/shared";

interface Props {
  series: UsageDayPoint[];
  dailyBudget?: number | null;
  weeklyBudget?: number | null;
  weekOnly?: boolean;
  className?: string;
}

const BLUE = "#3b82f6";
const BLUE_LIGHT = "#93c5fd";
const RED = "#ef4444";
const AMBER = "#f59e0b";

/** Returns the ISO date string (YYYY-MM-DD) for the most recent Monday in local time */
function currentWeekStart(): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  now.setDate(now.getDate() + diff);
  return now.toISOString().slice(0, 10);
}

export function ClaudeUsageChart({ series, dailyBudget, weeklyBudget, weekOnly = false, className }: Props) {
  const { data, periodLimit } = useMemo(() => {
    const filteredSeries = weekOnly
      ? series.filter((p) => p.date >= currentWeekStart())
      : series;

    const dailyLimit = dailyBudget ?? (weeklyBudget ? weeklyBudget / 7 : null);
    const periodLimit = dailyLimit && filteredSeries.length > 0
      ? weekOnly && weeklyBudget
        ? weeklyBudget
        : Math.round(dailyLimit * filteredSeries.length)
      : null;

    let cumTotal = 0;
    let cumOH = 0;
    const data = filteredSeries.map((p, i) => {
      cumTotal += p.totalTokens;
      cumOH += p.openHelmTokens;
      return {
        date: p.date.slice(5),
        total: cumTotal,
        openhelm: cumOH,
        pace: periodLimit ? Math.round((periodLimit / series.length) * (i + 1)) : undefined,
      };
    });

    return { data, periodLimit };
  }, [series, dailyBudget, weeklyBudget, weekOnly]);

  if (series.length === 0) {
    return (
      <div className={cn("rounded-lg border border-border bg-card px-4 py-5 text-center", className)}>
        <p className="text-xs text-muted-foreground">No historical data yet.</p>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border border-border bg-card p-3", className)}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 text-3xs text-muted-foreground">
          <span className="inline-block h-[2px] w-4 rounded-full" style={{ background: BLUE }} /> Cumulative Total
        </span>
        <span className="flex items-center gap-1.5 text-3xs text-muted-foreground">
          <span className="inline-block h-[2px] w-4 rounded-full" style={{ background: BLUE_LIGHT }} /> OpenHelm
        </span>
        {periodLimit && (
          <>
            <span className="flex items-center gap-1.5 text-3xs text-muted-foreground">
              <span className="inline-block h-0 w-4 border-t border-dashed" style={{ borderColor: RED }} /> Limit
            </span>
            <span className="flex items-center gap-1.5 text-3xs text-muted-foreground">
              <span className="inline-block h-0 w-4 border-t border-dashed" style={{ borderColor: AMBER }} /> On-track
            </span>
          </>
        )}
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1c3048" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6B8EAE" }} tickLine={false} axisLine={false} interval={weekOnly ? 0 : 6} />
          <YAxis tick={{ fontSize: 10, fill: "#6B8EAE" }} tickLine={false} axisLine={false}
            tickFormatter={(v: number) => formatTokenCount(v)} width={48} />
          <Tooltip
            formatter={(value) => [formatTokenCount(Number(value))]}
            contentStyle={{ backgroundColor: "#0c1522", border: "1px solid #1c3048", borderRadius: 8, fontSize: 12, color: "#F8FAFC" }}
            labelStyle={{ color: "#6B8EAE", marginBottom: 4 }}
            itemStyle={{ padding: 0 }}
          />
          <Area type="monotone" dataKey="total" name="Total" fill={BLUE} fillOpacity={0.12}
            stroke={BLUE} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Area type="monotone" dataKey="openhelm" name="OpenHelm" fill={BLUE_LIGHT} fillOpacity={0.1}
            stroke={BLUE_LIGHT} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          {periodLimit && <ReferenceLine y={periodLimit} stroke={RED} strokeDasharray="5 3" strokeWidth={1} />}
          {periodLimit && (
            <Line type="linear" dataKey="pace" name="On-track" stroke={AMBER} strokeOpacity={0.6}
              strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

import { cn } from "@/lib/utils";
import { formatTokenCount } from "@/lib/format";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { UsageSummary, UsagePeriodStat } from "@openhelm/shared";

interface Props {
  summary: UsageSummary;
  className?: string;
}

interface CardProps {
  label: string;
  current: UsagePeriodStat;
  prev: UsagePeriodStat;
  budget: number | null;
  useSonnet?: boolean;
}

function deltaPercent(current: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((current - prev) / prev) * 100);
}

function DeltaBadge({ current, prev }: { current: number; prev: number }) {
  const pct = deltaPercent(current, prev);
  if (pct === null) return null;
  const abs = Math.abs(pct);
  const up = pct > 0;
  const neutral = pct === 0;
  return (
    <span className={cn("flex items-center gap-0.5 text-3xs tabular-nums",
      neutral ? "text-muted-foreground" : up ? "text-rose-500" : "text-emerald-500")}>
      {neutral ? <Minus className="size-2.5" /> : up ? <TrendingUp className="size-2.5" /> : <TrendingDown className="size-2.5" />}
      {abs}%
    </span>
  );
}

function UsageCard({ label, current, prev, budget, useSonnet = false }: CardProps) {
  const currentTotal = useSonnet ? current.sonnetTokens : current.totalTokens;
  const prevTotal = useSonnet ? prev.sonnetTokens : prev.totalTokens;
  const ohTokens = current.openHelmTokens;
  const pct = budget ? Math.min(Math.round((currentTotal / budget) * 100), 100) : null;
  const barColor = pct === null ? "bg-blue-500/60"
    : pct >= 90 ? "bg-rose-500" : pct >= 75 ? "bg-amber-500" : "bg-blue-500";

  return (
    <div className="flex-1 min-w-0 rounded-lg border border-border bg-card p-3">
      {/* Label + percentage */}
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-2xs text-muted-foreground font-medium">{label}</p>
        {pct !== null && (
          <span className={cn("text-xs font-semibold tabular-nums",
            pct >= 90 ? "text-rose-500" : pct >= 75 ? "text-amber-500" : "text-muted-foreground")}>
            {pct}% used
          </span>
        )}
      </div>

      {/* Capacity bar */}
      <div className="w-full rounded bg-muted/50 overflow-hidden" style={{ height: 8 }}>
        <div
          className={cn("h-full rounded transition-all duration-500", barColor)}
          style={{ width: pct !== null ? `${pct}%` : "0%" }}
        />
      </div>

      {/* Token count */}
      <div className="mt-2 flex items-baseline gap-1 leading-tight">
        <span className="text-lg font-bold tabular-nums">{formatTokenCount(currentTotal)}</span>
        {budget !== null && (
          <span className="text-2xs text-muted-foreground tabular-nums">/ {formatTokenCount(budget)}</span>
        )}
      </div>

      {/* OpenHelm + delta */}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-3xs">
        <span className="text-muted-foreground whitespace-nowrap">
          <span className="font-medium text-primary">{formatTokenCount(ohTokens)}</span> via OpenHelm
        </span>
        <span className="flex items-center gap-1 text-muted-foreground whitespace-nowrap">
          <span className="text-muted-foreground/40">vs prev</span>
          <DeltaBadge current={currentTotal} prev={prevTotal} />
        </span>
      </div>
    </div>
  );
}

export function ClaudeUsageWidgets({ summary, className }: Props) {
  const { today, todayPrev, week, weekPrev, dailyBudget, weeklyBudget, dataSource } = summary;

  return (
    <div className={className}>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
        <UsageCard label="Today" current={today} prev={todayPrev} budget={dailyBudget} />
        <UsageCard label="This Week" current={week} prev={weekPrev} budget={weeklyBudget} />
        <UsageCard label="This Week (Sonnet)" current={week} prev={weekPrev} budget={weeklyBudget} useSonnet />
      </div>
      {dataSource === "openhelm_only" && (
        <p className="mt-1.5 text-3xs text-muted-foreground text-center">
          OpenHelm usage only — <code>~/.claude/projects/</code> not found
        </p>
      )}
    </div>
  );
}

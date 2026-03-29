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
    <span
      className={cn(
        "flex items-center gap-0.5 text-[10px] tabular-nums",
        neutral
          ? "text-muted-foreground"
          : up
          ? "text-rose-500 dark:text-rose-400"
          : "text-emerald-600 dark:text-emerald-400",
      )}
    >
      {neutral ? (
        <Minus className="size-2.5" />
      ) : up ? (
        <TrendingUp className="size-2.5" />
      ) : (
        <TrendingDown className="size-2.5" />
      )}
      {abs}%
    </span>
  );
}

function BudgetBar({
  used,
  budget,
}: {
  used: number;
  budget: number;
}) {
  const pct = Math.min((used / budget) * 100, 100);
  const color =
    pct >= 90
      ? "bg-rose-500"
      : pct >= 75
      ? "bg-amber-500"
      : pct >= 50
      ? "bg-yellow-500"
      : "bg-primary";

  return (
    <div className="mt-1.5 w-full rounded-full bg-muted/40 overflow-hidden" style={{ height: 4 }}>
      <div
        className={cn("h-full rounded-full transition-all duration-300", color)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function UsageCard({ label, current, prev, budget, useSonnet = false }: CardProps) {
  const currentTotal = useSonnet ? current.sonnetTokens : current.totalTokens;
  const prevTotal = useSonnet ? prev.sonnetTokens : prev.totalTokens;
  const ohTokens = current.openHelmTokens;

  // OpenHelm stacked bar proportion (relative to total)
  const ohPct = currentTotal > 0 ? Math.min((ohTokens / currentTotal) * 100, 100) : 0;

  const budgetPct =
    budget && currentTotal > 0
      ? Math.round((currentTotal / budget) * 100)
      : null;

  return (
    <div className="flex-1 min-w-0 rounded-lg border border-border bg-card p-3">
      <p className="text-[11px] text-muted-foreground mb-1">{label}</p>

      <p className="text-lg font-bold tabular-nums leading-tight">
        {formatTokenCount(currentTotal)}
      </p>

      {/* OpenHelm vs total bar */}
      <div className="mt-1.5 w-full rounded-full bg-muted/40 overflow-hidden" style={{ height: 6 }}>
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${ohPct}%` }}
          title={`OpenHelm: ${formatTokenCount(ohTokens)}`}
        />
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        <span className="font-medium text-primary">{formatTokenCount(ohTokens)}</span>
        {" "}via OpenHelm
      </p>

      {/* Budget gauge */}
      {budget !== null && budgetPct !== null && (
        <>
          <BudgetBar used={currentTotal} budget={budget} />
          <p
            className={cn(
              "mt-1 text-[10px] font-medium",
              budgetPct >= 90
                ? "text-rose-500"
                : budgetPct >= 75
                ? "text-amber-500"
                : "text-muted-foreground",
            )}
          >
            {budgetPct}% of budget
          </p>
        </>
      )}

      {/* Delta vs previous period */}
      <div className="mt-1.5 flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground">vs prev:</span>
        <DeltaBadge current={currentTotal} prev={prevTotal} />
        {prevTotal === 0 && (
          <span className="text-[10px] text-muted-foreground">no data</span>
        )}
      </div>
    </div>
  );
}

export function ClaudeUsageWidgets({ summary, className }: Props) {
  const { today, todayPrev, week, weekPrev, dailyBudget, weeklyBudget, dataSource } = summary;

  return (
    <div className={className}>
      <div className="flex gap-2">
        <UsageCard
          label="Today"
          current={today}
          prev={todayPrev}
          budget={dailyBudget}
        />
        <UsageCard
          label="This Week"
          current={week}
          prev={weekPrev}
          budget={weeklyBudget}
        />
        <UsageCard
          label="This Week (Sonnet)"
          current={week}
          prev={weekPrev}
          budget={weeklyBudget}
          useSonnet
        />
      </div>
      {dataSource === "openhelm_only" && (
        <p className="mt-1.5 text-[10px] text-muted-foreground text-center">
          OpenHelm usage only — <code>~/.claude/projects/</code> not found
        </p>
      )}
    </div>
  );
}

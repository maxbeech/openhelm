/**
 * UsageDashboard — cloud mode billing/usage overview.
 *
 * Fetches data from the `usage-report` Supabase Edge Function and displays:
 *  - Token credits used vs included (progress bar)
 *  - Breakdown by model tier (Haiku, Sonnet, Opus)
 *  - Breakdown by call type (execution, chat, planning, assessment)
 *  - Cost projection for current period
 *  - Daily usage bar chart
 *
 * Only rendered in cloud mode (caller must check isCloudMode).
 */

import { useEffect, useState } from "react";
import { Loader2, TrendingUp, Zap } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { UsageChart } from "./usage-chart";
import { getSupabaseClient } from "@/lib/supabase-client";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CallBreakdown {
  inputTokens: number;
  outputTokens: number;
  billedUsd: number;
}

interface UsageReport {
  plan: "basic" | "pro" | "max" | null;
  status: "active" | "past_due" | "cancelled" | "trialing" | null;
  periodStart: string | null;
  periodEnd: string | null;
  includedCredits: number | null;
  usedCredits: number;
  remainingCredits: number | null;
  breakdown: {
    execution: CallBreakdown;
    planning: CallBreakdown;
    chat: CallBreakdown;
    assessment: CallBreakdown;
  };
  totalBilledUsd: number;
}

interface DailyBucket {
  date: string;
  tokens: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const PLAN_LABELS: Record<string, string> = {
  basic: "Basic",
  pro: "Pro",
  max: "Max",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  trialing: "outline",
  past_due: "destructive",
  cancelled: "secondary",
};

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

function formatUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function usagePct(used: number, included: number | null): number {
  if (!included) return 0;
  return Math.min(100, Math.round((used / included) * 100));
}

/** Build daily buckets for the bar chart from usage records. */
function buildDailyBuckets(
  periodStart: string | null,
  periodEnd: string | null,
  records: Array<{ created_at: string; input_tokens: number; output_tokens: number }>,
): DailyBucket[] {
  const start = periodStart ? new Date(periodStart) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const end = periodEnd ? new Date(periodEnd) : new Date();
  const today = new Date();
  const endBound = end < today ? end : today;

  const buckets = new Map<string, number>();
  const cur = new Date(start);
  while (cur <= endBound) {
    const key = cur.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    buckets.set(key, 0);
    cur.setDate(cur.getDate() + 1);
  }

  for (const r of records) {
    const d = new Date(r.created_at);
    const key = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    if (buckets.has(key)) {
      // Approximate Haiku-equivalent tokens (output is 5× more expensive than input)
      buckets.set(key, (buckets.get(key) ?? 0) + r.input_tokens + r.output_tokens * 5);
    }
  }

  return Array.from(buckets.entries()).map(([date, tokens]) => ({ date, tokens }));
}

// ── Component ──────────────────────────────────────────────────────────────────

export function UsageDashboard() {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [dailyBuckets, setDailyBuckets] = useState<DailyBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const supabase = getSupabaseClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Not authenticated");

        // Fetch usage report from Edge Function
        const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) ?? "";
        const res = await fetch(`${supabaseUrl}/functions/v1/usage-report`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) throw new Error(`Usage report failed: HTTP ${res.status}`);
        const data = (await res.json()) as UsageReport;

        // Fetch raw usage_records for the daily chart
        const { data: records, error: dbErr } = await supabase
          .from("usage_records")
          .select("created_at, input_tokens, output_tokens")
          .gte("created_at", data.periodStart ?? new Date(0).toISOString())
          .lte("created_at", data.periodEnd ?? new Date().toISOString());

        if (dbErr) throw new Error(dbErr.message);

        if (!cancelled) {
          setReport(data);
          setDailyBuckets(buildDailyBuckets(data.periodStart, data.periodEnd, records ?? []));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load usage data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading usage…
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (!report) return null;

  const pct = usagePct(report.usedCredits, report.includedCredits);
  const periodLabel = report.periodStart && report.periodEnd
    ? `${new Date(report.periodStart).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${new Date(report.periodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
    : null;

  // Cost projection (linear extrapolation through period)
  const projectedCost = (() => {
    if (!report.periodStart || !report.periodEnd) return null;
    const totalMs = new Date(report.periodEnd).getTime() - new Date(report.periodStart).getTime();
    const elapsedMs = Date.now() - new Date(report.periodStart).getTime();
    if (elapsedMs <= 0 || totalMs <= 0) return null;
    const fraction = Math.min(1, elapsedMs / totalMs);
    if (fraction < 0.01) return null;
    return report.totalBilledUsd / fraction;
  })();

  const callTypes = [
    { key: "execution" as const, label: "Execution" },
    { key: "chat" as const, label: "Chat" },
    { key: "planning" as const, label: "Planning" },
    { key: "assessment" as const, label: "Assessment" },
  ];

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="size-4 text-primary" />
          <span className="font-medium">Usage</span>
          {report.plan && (
            <Badge variant={STATUS_VARIANT[report.status ?? ""] ?? "secondary"}>
              {PLAN_LABELS[report.plan] ?? report.plan}
              {report.status === "trialing" ? " · Trial" : ""}
            </Badge>
          )}
        </div>
        {periodLabel && (
          <span className="text-xs text-muted-foreground">{periodLabel}</span>
        )}
      </div>

      {/* Credit usage */}
      {report.includedCredits !== null ? (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{formatTokens(report.usedCredits)} used</span>
            <span>{formatTokens(report.includedCredits)} included</span>
          </div>
          <Progress value={pct} className="h-2" />
          {report.remainingCredits !== null && (
            <p className="text-xs text-muted-foreground">
              {formatTokens(report.remainingCredits)} remaining
              {pct >= 90 && <span className="ml-1 text-yellow-500 font-medium">· Running low</span>}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {formatTokens(report.usedCredits)} tokens consumed (no active plan)
        </p>
      )}

      {/* Daily chart */}
      <div>
        <p className="mb-2 text-xs text-muted-foreground">Daily token usage</p>
        <UsageChart data={dailyBuckets} />
      </div>

      {/* Breakdown by call type */}
      <div>
        <p className="mb-2 text-xs text-muted-foreground">Breakdown by operation</p>
        <div className="space-y-1.5">
          {callTypes.map(({ key, label }) => {
            const b = report.breakdown[key];
            const total = b.inputTokens + b.outputTokens;
            return (
              <div key={key} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{label}</span>
                <div className="flex items-center gap-3">
                  <span className="text-foreground">{formatTokens(total)}</span>
                  <span className="text-muted-foreground w-16 text-right">{formatUsd(b.billedUsd)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cost summary */}
      <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Billed so far</span>
          <span className="font-medium">{formatUsd(report.totalBilledUsd)}</span>
        </div>
        {projectedCost !== null && (
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1 text-muted-foreground">
              <TrendingUp className="size-3" />
              Projected this period
            </span>
            <span className="text-muted-foreground">{formatUsd(projectedCost)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

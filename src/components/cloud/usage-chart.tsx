/**
 * UsageChart — bar chart of daily token usage over the current billing period.
 *
 * Uses recharts (already in project deps) to render a simple bar chart.
 * Only shown in cloud mode.
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface DailyBucket {
  date: string;        // "Apr 1"
  tokens: number;      // Haiku-equivalent tokens
}

interface UsageChartProps {
  data: DailyBucket[];
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function UsageChart({ data }: UsageChartProps) {
  if (data.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No usage data yet.</p>
    );
  }

  const maxTokens = Math.max(...data.map((d) => d.tokens), 1);

  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={data} margin={{ top: 4, right: 0, left: -24, bottom: 0 }}>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={formatTokens}
          domain={[0, maxTokens]}
          width={48}
        />
        <Tooltip
          formatter={(value) => [formatTokens(Number(value)), "Tokens"]}
          contentStyle={{
            fontSize: 11,
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 6,
          }}
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
        />
        <Bar dataKey="tokens" radius={[3, 3, 0, 0]}>
          {data.map((_, index) => (
            <Cell
              key={index}
              fill={`hsl(var(--primary))`}
              fillOpacity={0.7 + 0.3 * (index / Math.max(data.length - 1, 1))}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

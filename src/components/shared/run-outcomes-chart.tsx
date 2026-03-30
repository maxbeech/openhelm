import { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { Run } from "@openhelm/shared";

interface Props {
  runs: Run[];
}

const DAYS = 14;
const GREEN = "#22c55e";
const RED = "#ef4444";

export function RunOutcomesChart({ runs }: Props) {
  const data = useMemo(() => {
    const now = new Date();
    const buckets: Record<string, { date: string; Succeeded: number; Failed: number }> = {};

    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      buckets[key] = { date: key, Succeeded: 0, Failed: 0 };
    }

    for (const run of runs) {
      const d = new Date(run.createdAt);
      const diff = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
      if (diff < 0 || diff >= DAYS) continue;
      const key = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!buckets[key]) continue;
      if (run.status === "succeeded") buckets[key].Succeeded++;
      else if (run.status === "failed" || run.status === "permanent_failure") buckets[key].Failed++;
    }

    return Object.values(buckets);
  }, [runs]);

  const maxVal = useMemo(() => Math.max(...data.map((d) => d.Succeeded + d.Failed), 1), [data]);
  const hasData = data.some((d) => d.Succeeded > 0 || d.Failed > 0);

  if (!hasData) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
        No completed runs in the last {DAYS} days.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -8 }} barGap={1}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1c3048" vertical={false} />
          <XAxis
            dataKey="date" tick={{ fontSize: 10, fill: "#6B8EAE" }}
            tickLine={false} axisLine={false} interval={1}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#6B8EAE" }} tickLine={false} axisLine={false}
            allowDecimals={false} domain={[0, Math.ceil(maxVal * 1.2)]}
            tickCount={Math.min(maxVal + 1, 5)} width={24}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={{
              backgroundColor: "#0c1522", border: "1px solid #1c3048",
              borderRadius: 8, fontSize: 12, color: "#F8FAFC",
              boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            }}
            labelStyle={{ color: "#6B8EAE", fontWeight: 600, marginBottom: 4 }}
            itemStyle={{ padding: "1px 0" }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
            iconType="square" iconSize={10}
          />
          <Bar dataKey="Succeeded" stackId="a" fill={GREEN} radius={[0, 0, 0, 0]} />
          <Bar dataKey="Failed" stackId="a" fill={RED} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

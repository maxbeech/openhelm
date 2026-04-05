import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { VisualizationConfig, DataTableRow, DataTableColumn } from "@openhelm/shared";
import { computeStatValue } from "./chart-data-utils";

interface Props {
  config: VisualizationConfig;
  rows: DataTableRow[];
  columns: DataTableColumn[];
  compact?: boolean;
}

export function StatCardViz({ config, rows, columns, compact }: Props) {
  const value = computeStatValue(config, rows);
  const colId = config.statColumnId;
  const col = colId ? columns.find((c) => c.id === colId) : null;
  const label = config.statLabel ?? col?.name ?? "Value";
  const agg = config.statAggregation ?? "latest";

  // Compute trend from last 2 values
  let trend: "up" | "down" | "flat" | null = null;
  if (rows.length >= 2 && colId) {
    const lastTwo = rows.slice(-2);
    const prev = lastTwo[0].data[colId];
    const curr = lastTwo[1].data[colId];
    if (typeof prev === "number" && typeof curr === "number") {
      if (curr > prev) trend = "up";
      else if (curr < prev) trend = "down";
      else trend = "flat";
    }
  }

  const formattedValue = value !== null
    ? Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "—";

  return (
    <div className={`flex flex-col items-center justify-center ${compact ? "py-4" : "py-8"}`}>
      <div className={`font-bold ${compact ? "text-2xl" : "text-4xl"} tracking-tight`}>
        {formattedValue}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-muted-foreground text-xs">
        <span>{label}</span>
        <span className="opacity-50">({agg})</span>
        {trend === "up" && <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />}
        {trend === "down" && <TrendingDown className="h-3.5 w-3.5 text-rose-500" />}
        {trend === "flat" && <Minus className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
    </div>
  );
}

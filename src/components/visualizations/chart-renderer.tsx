import { useMemo, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { Visualization, DataTableColumn, DataTableRow, VisualizationSeriesConfig } from "@openhelm/shared";
import { prepareChartData, preparePieData } from "./chart-data-utils";
import { LineChartViz } from "./line-chart";
import { BarChartViz } from "./bar-chart";
import { AreaChartViz } from "./area-chart";
import { PieChartViz } from "./pie-chart";
import { StatCardViz } from "./stat-card";
import * as api from "@/lib/api";

interface Props {
  visualization: Visualization;
  compact?: boolean;
}

// ─── Time period config ───

const TIME_PERIODS: { label: string; days: number | null }[] = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "All", days: null },
];

const DEFAULT_PERIOD_DAYS = 30;
const DOWNSAMPLE_THRESHOLD = 60; // rows beyond this get grouped by day

// ─── Downsampling ───

function downsampleByDay(
  rows: DataTableRow[],
  xColumnId: string,
  series: VisualizationSeriesConfig[],
): DataTableRow[] {
  const groups = new Map<string, DataTableRow[]>();

  for (const row of rows) {
    const raw = row.data[xColumnId];
    if (!raw) continue;
    try {
      const dayKey = new Date(String(raw)).toISOString().slice(0, 10);
      if (!groups.has(dayKey)) groups.set(dayKey, []);
      groups.get(dayKey)!.push(row);
    } catch {
      // skip unparseable
    }
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, groupRows]) => {
      const data: Record<string, unknown> = {
        [xColumnId]: `${dayKey}T00:00:00.000Z`,
      };
      for (const s of series) {
        const vals = groupRows
          .map((r) => r.data[s.columnId])
          .filter((v): v is number => typeof v === "number");
        if (vals.length > 0) {
          data[s.columnId] = vals.reduce((a, b) => a + b, 0) / vals.length;
        }
      }
      return {
        id: dayKey,
        tableId: groupRows[0].tableId,
        sortOrder: 0,
        data,
        createdAt: dayKey,
      } as DataTableRow;
    });
}

// ─── Component ───

export function ChartRenderer({ visualization, compact }: Props) {
  const [rows, setRows] = useState<DataTableRow[]>([]);
  const [columns, setColumns] = useState<DataTableColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timePeriodDays, setTimePeriodDays] = useState<number | null>(DEFAULT_PERIOD_DAYS);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [table, fetchedRows] = await Promise.all([
          api.getDataTable(visualization.dataTableId),
          api.listDataTableRows({
            tableId: visualization.dataTableId,
            limit: visualization.config.rowLimit ?? 2000, // fetch more so period filter has material
          }),
        ]);
        if (cancelled) return;
        setColumns(table.columns);
        setRows(fetchedRows);
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [visualization.dataTableId, visualization.config.rowLimit]);

  // Detect whether this chart can use time-period filtering
  const xCol = useMemo(
    () => columns.find((c) => c.id === visualization.config.xColumnId),
    [columns, visualization.config.xColumnId],
  );
  const isTimeSeries =
    (visualization.chartType === "line" || visualization.chartType === "area") &&
    xCol != null;

  // Filter rows by selected time period
  const periodRows = useMemo(() => {
    if (!isTimeSeries || timePeriodDays === null || !xCol) return rows;
    const cutoffMs = Date.now() - timePeriodDays * 24 * 60 * 60 * 1000;
    return rows.filter((r) => {
      const v = r.data[xCol.id];
      if (!v) return true;
      try {
        const t = new Date(String(v)).getTime();
        return !isNaN(t) && t >= cutoffMs;
      } catch {
        return true;
      }
    });
  }, [rows, timePeriodDays, isTimeSeries, xCol]);

  // Downsample if too many points
  const displayRows = useMemo(() => {
    if (!isTimeSeries || !xCol || periodRows.length <= DOWNSAMPLE_THRESHOLD) {
      return periodRows;
    }
    return downsampleByDay(periodRows, xCol.id, visualization.config.series);
  }, [periodRows, isTimeSeries, xCol, visualization.config.series]);

  // Check for missing columns
  const missingColumns = useMemo(() => {
    const colIds = new Set(columns.map((c) => c.id));
    const referenced = [
      ...visualization.config.series.map((s) => s.columnId),
      visualization.config.xColumnId,
      visualization.config.valueColumnId,
      visualization.config.labelColumnId,
      visualization.config.statColumnId,
    ].filter(Boolean) as string[];
    return referenced.filter((id) => !colIds.has(id));
  }, [columns, visualization.config]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center text-muted-foreground text-xs ${compact ? "h-32" : "h-48"}`}>
        Loading chart data…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-4 text-xs text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" />
        Failed to load chart data
      </div>
    );
  }

  if (missingColumns.length > 0) {
    return (
      <div className="flex items-center gap-2 p-4 text-xs text-amber-500">
        <AlertTriangle className="h-3.5 w-3.5" />
        Some columns referenced by this chart have been deleted
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={`flex items-center justify-center text-muted-foreground text-xs ${compact ? "h-32" : "h-48"}`}>
        No data yet — rows will appear as they are added
      </div>
    );
  }

  const { config, chartType } = visualization;

  return (
    <div>
      {/* Time period controls — only for time-series charts, not in compact mode */}
      {isTimeSeries && !compact && (
        <div className="flex items-center gap-1 px-3 pt-2">
          {TIME_PERIODS.map(({ label, days }) => (
            <button
              key={label}
              onClick={() => setTimePeriodDays(days)}
              className={[
                "text-3xs px-2 py-0.5 rounded-full border transition-colors",
                timePeriodDays === days
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
          {isTimeSeries && displayRows.length !== periodRows.length && (
            <span className="text-3xs text-muted-foreground ml-1">
              avg/day
            </span>
          )}
        </div>
      )}

      {/* Chart */}
      {(() => {
        switch (chartType) {
          case "line": {
            const data = prepareChartData(config, displayRows, columns);
            return <LineChartViz data={data} config={config} columns={columns} compact={compact} />;
          }
          case "bar": {
            const data = prepareChartData(config, displayRows, columns);
            return <BarChartViz data={data} config={config} columns={columns} compact={compact} />;
          }
          case "area": {
            const data = prepareChartData(config, displayRows, columns);
            return <AreaChartViz data={data} config={config} columns={columns} compact={compact} />;
          }
          case "pie": {
            const data = preparePieData(config, rows, columns);
            return <PieChartViz data={data} config={config} compact={compact} />;
          }
          case "stat": {
            return <StatCardViz config={config} rows={rows} columns={columns} compact={compact} />;
          }
          default:
            return <div className="text-xs text-muted-foreground p-4">Unsupported chart type</div>;
        }
      })()}
    </div>
  );
}

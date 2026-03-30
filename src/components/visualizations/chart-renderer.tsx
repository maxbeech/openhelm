import { useMemo, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { Visualization, DataTableColumn, DataTableRow } from "@openhelm/shared";
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

export function ChartRenderer({ visualization, compact }: Props) {
  const [rows, setRows] = useState<DataTableRow[]>([]);
  const [columns, setColumns] = useState<DataTableColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
            limit: visualization.config.rowLimit ?? 500,
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

  switch (chartType) {
    case "line": {
      const data = prepareChartData(config, rows, columns);
      return <LineChartViz data={data} config={config} columns={columns} compact={compact} />;
    }
    case "bar": {
      const data = prepareChartData(config, rows, columns);
      return <BarChartViz data={data} config={config} columns={columns} compact={compact} />;
    }
    case "area": {
      const data = prepareChartData(config, rows, columns);
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
}

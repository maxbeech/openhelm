import type {
  Visualization,
  DataTableColumn,
  DataTableRow,
  VisualizationConfig,
} from "@openhelm/shared";

export interface ChartDataPoint {
  x: string;
  [key: string]: string | number | null;
}

/** Prepare rows into Recharts-compatible data points */
export function prepareChartData(
  config: VisualizationConfig,
  rows: DataTableRow[],
  columns: DataTableColumn[],
): ChartDataPoint[] {
  const limited = config.rowLimit
    ? rows.slice(0, config.rowLimit)
    : rows.slice(0, 500);

  const colMap = new Map(columns.map((c) => [c.id, c]));
  const xCol = config.xColumnId ? colMap.get(config.xColumnId) : null;

  const points: ChartDataPoint[] = limited.map((row, index) => {
    const point: ChartDataPoint = {
      x: xCol ? formatXValue(row.data[xCol.id], xCol.type) : String(index + 1),
    };

    for (const series of config.series) {
      const val = row.data[series.columnId];
      point[series.columnId] = typeof val === "number" ? val : parseNumeric(val);
    }

    return point;
  });

  const dir = config.sortDirection ?? "asc";
  if (xCol?.type === "date") {
    points.sort((a, b) => {
      const cmp = String(a.x).localeCompare(String(b.x));
      return dir === "asc" ? cmp : -cmp;
    });
  }

  return points;
}

/** Prepare data for pie charts */
export function preparePieData(
  config: VisualizationConfig,
  rows: DataTableRow[],
  columns: DataTableColumn[],
): { name: string; value: number }[] {
  const colMap = new Map(columns.map((c) => [c.id, c]));
  const valCol = config.valueColumnId;
  const labelCol = config.labelColumnId;
  if (!valCol) return [];

  const limited = rows.slice(0, 20);

  return limited
    .map((row, index) => {
      const rawVal = row.data[valCol];
      const value = typeof rawVal === "number" ? rawVal : parseNumeric(rawVal);
      if (value === null || value <= 0) return null;

      const labelColDef = labelCol ? colMap.get(labelCol) : null;
      const rawLabel = labelCol ? row.data[labelCol] : null;
      const name = rawLabel
        ? String(rawLabel)
        : labelColDef
          ? `Row ${index + 1}`
          : `Row ${index + 1}`;

      return { name, value };
    })
    .filter((d): d is { name: string; value: number } => d !== null);
}

/** Compute a stat value from rows */
export function computeStatValue(
  config: VisualizationConfig,
  rows: DataTableRow[],
): number | null {
  const colId = config.statColumnId;
  if (!colId) return null;

  const values = rows
    .map((r) => r.data[colId])
    .map((v) => (typeof v === "number" ? v : parseNumeric(v)))
    .filter((v): v is number => v !== null);

  if (values.length === 0) return null;

  const agg = config.statAggregation ?? "latest";
  switch (agg) {
    case "latest":
      return values[values.length - 1];
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "max":
      return Math.max(...values);
    case "min":
      return Math.min(...values);
    case "count":
      return values.length;
    default:
      return values[values.length - 1];
  }
}

/** Get series labels from columns for display */
export function getSeriesLabel(
  columnId: string,
  columns: DataTableColumn[],
  labelOverride?: string,
): string {
  if (labelOverride) return labelOverride;
  const col = columns.find((c) => c.id === columnId);
  return col?.name ?? columnId;
}

function formatXValue(val: unknown, colType: string): string {
  if (val === null || val === undefined) return "";
  if (colType === "date" && typeof val === "string") {
    try {
      const d = new Date(val);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return String(val);
    }
  }
  return String(val);
}

function parseNumeric(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = Number(val);
    return isNaN(n) ? null : n;
  }
  return null;
}

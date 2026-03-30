import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { VisualizationConfig, DataTableColumn } from "@openhelm/shared";
import type { ChartDataPoint } from "./chart-data-utils";
import { getChartColor } from "./chart-colors";
import { getSeriesLabel } from "./chart-data-utils";

interface Props {
  data: ChartDataPoint[];
  config: VisualizationConfig;
  columns: DataTableColumn[];
  compact?: boolean;
}

export function LineChartViz({ data, config, columns, compact }: Props) {
  const height = compact ? 180 : 280;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: compact ? 0 : 8 }}>
        {config.showGrid !== false && (
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
        )}
        <XAxis
          dataKey="x"
          tick={{ fontSize: compact ? 10 : 12 }}
          className="fill-muted-foreground"
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: compact ? 10 : 12 }}
          className="fill-muted-foreground"
          tickLine={false}
          axisLine={false}
          width={compact ? 30 : 40}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
            fontSize: 12,
            color: "hsl(var(--popover-foreground))",
          }}
        />
        {config.showLegend && !compact && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {config.series.map((s, i) => (
          <Line
            key={s.columnId}
            type="monotone"
            dataKey={s.columnId}
            name={getSeriesLabel(s.columnId, columns, s.label)}
            stroke={getChartColor(i, config.colors)}
            strokeWidth={2}
            dot={data.length <= 20}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

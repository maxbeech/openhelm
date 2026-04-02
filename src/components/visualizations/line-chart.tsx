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
          cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 }}
          contentStyle={{
            backgroundColor: "#0c1522",
            border: "1px solid #1c3048",
            borderRadius: 8,
            fontSize: 12,
            color: "#F8FAFC",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
          labelStyle={{ color: "#6B8EAE", fontWeight: 600, marginBottom: 4 }}
          itemStyle={{ padding: "1px 0" }}
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

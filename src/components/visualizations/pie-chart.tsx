import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";
import type { VisualizationConfig } from "@openhelm/shared";
import { getChartColor } from "./chart-colors";

interface Props {
  data: { name: string; value: number }[];
  config: VisualizationConfig;
  compact?: boolean;
}

export function PieChartViz({ data, config, compact }: Props) {
  const height = compact ? 180 : 280;
  const innerRadius = compact ? 30 : 50;
  const outerRadius = compact ? 60 : 90;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          dataKey="value"
          nameKey="name"
          paddingAngle={2}
          label={!compact}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={getChartColor(i, config.colors)} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
            fontSize: 12,
            color: "hsl(var(--popover-foreground))",
          }}
        />
        {config.showLegend !== false && <Legend wrapperStyle={{ fontSize: 12 }} />}
      </PieChart>
    </ResponsiveContainer>
  );
}

import { useMemo, useState, useRef, useCallback } from "react";
import { formatTokenCount } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { UsageDayPoint } from "@openhelm/shared";

interface Props {
  series: UsageDayPoint[];
  className?: string;
}

// Pixel dimensions for the chart drawing area
const W = 500;
const H = 80;
const PAD_LEFT = 0;
const PAD_BOTTOM = 18; // space for x-axis labels
const X_LABEL_EVERY = 7;

function toPoints(data: number[], maxVal: number): string {
  if (data.length === 0) return "";
  const n = data.length;
  return data
    .map((v, i) => {
      const x = n === 1 ? W / 2 : PAD_LEFT + (i / (n - 1)) * (W - PAD_LEFT);
      const y = maxVal > 0 ? H - (v / maxVal) * H : H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function ClaudeUsageChart({ series, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    pct: number; // 0-1 horizontal position in chart
    point: UsageDayPoint;
  } | null>(null);

  const { totals, openHelms, maxVal, xLabels } = useMemo(() => {
    const totals = series.map((p) => p.totalTokens);
    const openHelms = series.map((p) => p.openHelmTokens);
    const maxVal = Math.max(...totals, 1);
    const n = series.length;
    const xLabels = series
      .map((p, i) => {
        if (i % X_LABEL_EVERY !== 0) return null;
        const x = n === 1 ? W / 2 : PAD_LEFT + (i / (n - 1)) * (W - PAD_LEFT);
        return { x, label: p.date.slice(5) };
      })
      .filter(Boolean) as { x: number; label: string }[];
    return { totals, openHelms, maxVal, xLabels };
  }, [series]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, relX / rect.width));
    const n = series.length;
    const idx = Math.min(Math.round(pct * (n - 1)), n - 1);
    setTooltip({ pct, point: series[Math.max(0, idx)] });
  }, [series]);

  if (series.length === 0) {
    return (
      <div className={cn("rounded-lg border border-border bg-card px-4 py-5 text-center", className)}>
        <p className="text-xs text-muted-foreground">No historical data yet.</p>
      </div>
    );
  }

  const n = series.length;
  const totalSvgH = H + PAD_BOTTOM;

  // Tooltip x position (clamped so it doesn't go off-screen)
  const tooltipIdx = tooltip
    ? Math.min(Math.round(tooltip.pct * (n - 1)), n - 1)
    : -1;
  const tooltipSvgX =
    tooltipIdx >= 0
      ? (n === 1 ? W / 2 : PAD_LEFT + (tooltipIdx / (n - 1)) * (W - PAD_LEFT))
      : 0;

  return (
    <div className={cn("rounded-lg border border-border bg-card p-3", className)}>
      <div className="mb-2 flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="inline-block h-[2px] w-4 rounded-full bg-primary" />
          Total
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="inline-block h-[2px] w-4 rounded-full bg-primary/40" />
          OpenHelm
        </span>
      </div>

      <div className="relative" ref={containerRef}>
        <svg
          viewBox={`0 0 ${W} ${totalSvgH}`}
          className="w-full"
          style={{ height: 98, display: "block" }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setTooltip(null)}
        >
          {/* Horizontal grid lines */}
          {[0.25, 0.5, 0.75, 1].map((f) => {
            const y = H - f * H;
            return (
              <line
                key={f}
                x1={PAD_LEFT}
                y1={y}
                x2={W}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.08}
                strokeWidth={1}
                className="text-muted-foreground"
              />
            );
          })}

          {/* Area fill — total */}
          <polygon
            points={`${PAD_LEFT},${H} ${toPoints(totals, maxVal)} ${W - PAD_LEFT},${H}`}
            fill="currentColor"
            fillOpacity={0.07}
            className="text-primary"
          />

          {/* Area fill — openhelm */}
          <polygon
            points={`${PAD_LEFT},${H} ${toPoints(openHelms, maxVal)} ${W - PAD_LEFT},${H}`}
            fill="currentColor"
            fillOpacity={0.14}
            className="text-primary"
          />

          {/* Line — total */}
          <polyline
            points={toPoints(totals, maxVal)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="text-primary"
          />

          {/* Line — openhelm */}
          <polyline
            points={toPoints(openHelms, maxVal)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray="4 3"
            className="text-primary/60"
          />

          {/* X-axis labels */}
          {xLabels.map(({ x, label }) => (
            <text
              key={label}
              x={x}
              y={H + 13}
              textAnchor="middle"
              fontSize={11}
              fill="currentColor"
              fillOpacity={0.4}
              className="text-muted-foreground"
            >
              {label}
            </text>
          ))}

          {/* Hover vertical line */}
          {tooltip && (
            <line
              x1={tooltipSvgX}
              y1={0}
              x2={tooltipSvgX}
              y2={H}
              stroke="currentColor"
              strokeWidth={1}
              strokeOpacity={0.35}
              strokeDasharray="3 2"
              className="text-primary"
            />
          )}
        </svg>

        {/* Tooltip — positioned relative to container in CSS pixels */}
        {tooltip && tooltipIdx >= 0 && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-y-1 rounded-md border border-border bg-popover px-2.5 py-1.5 shadow-md text-[11px]"
            style={{
              left: Math.min(
                Math.max(tooltip.pct * 100, 0),
                80,
              ) + "%",
              transform: "translateX(-50%) translateY(-110%)",
              minWidth: 120,
            }}
          >
            <p className="font-medium text-foreground mb-0.5">{tooltip.point.date}</p>
            <p className="text-muted-foreground">
              Total:{" "}
              <span className="font-mono text-foreground">
                {formatTokenCount(tooltip.point.totalTokens)}
              </span>
            </p>
            <p className="text-muted-foreground">
              OpenHelm:{" "}
              <span className="font-mono text-foreground">
                {formatTokenCount(tooltip.point.openHelmTokens)}
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

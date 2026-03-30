/** Consistent chart colors matching the existing BAR_COLORS pattern */
export const CHART_COLORS = [
  "#3b82f6", // blue-500
  "#8b5cf6", // violet-500
  "#10b981", // emerald-500
  "#f59e0b", // amber-500
  "#f43f5e", // rose-500
  "#06b6d4", // cyan-500
  "#f97316", // orange-500
  "#ec4899", // pink-500
];

export function getChartColor(index: number, customColors?: string[]): string {
  if (customColors && customColors[index]) return customColors[index];
  return CHART_COLORS[index % CHART_COLORS.length];
}

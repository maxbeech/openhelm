/**
 * Visualization Suggester — deterministic monitoring that auto-creates
 * or suggests chart visualizations when data tables receive consistent
 * numeric data. No LLM calls needed.
 *
 * Gated by autopilot_mode:
 * - full_auto: creates active visualizations automatically
 * - approval_required: creates suggested visualizations for user review
 * - off: does nothing
 */

import { getDataTable, listDataTables } from "../db/queries/data-tables.js";
import {
  createVisualization,
  listVisualizations,
} from "../db/queries/visualizations.js";
import { getAutopilotMode } from "../autopilot/index.js";
import { emit } from "../ipc/emitter.js";
import type { DataTable, ChartType, VisualizationConfig, VisualizationSeriesConfig } from "@openhelm/shared";

// ─── Debounce tracking ───

const pendingChecks = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 30_000; // 30 seconds

/**
 * Schedule a visualization check for a table after a debounce period.
 * Called when dataTable.rowsChanged fires.
 */
export function scheduleVisualizationCheck(tableId: string): void {
  const mode = getAutopilotMode();
  if (mode === "off") return;

  // Clear any pending check for this table
  const existing = pendingChecks.get(tableId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingChecks.delete(tableId);
    try {
      checkAndSuggestVisualization(tableId);
    } catch (err) {
      console.error("[viz-suggester] check failed (non-fatal):", err);
    }
  }, DEBOUNCE_MS);

  pendingChecks.set(tableId, timer);
}

/**
 * Core check: does a table have uncovered numeric columns that need a chart?
 */
function checkAndSuggestVisualization(tableId: string): void {
  const mode = getAutopilotMode();
  if (mode === "off") return;

  const table = getDataTable(tableId);
  if (!table || table.rowCount < 5) return;

  const numericCols = table.columns.filter((c) => c.type === "number");
  if (numericCols.length === 0) return;

  const dateCols = table.columns.filter((c) => c.type === "date");

  // Check which columns are already covered by existing visualizations
  const existingVizs = listVisualizations({ dataTableId: tableId });
  const coveredColIds = new Set(
    existingVizs.flatMap((v) => [
      ...v.config.series.map((s: VisualizationSeriesConfig) => s.columnId),
      v.config.valueColumnId,
      v.config.statColumnId,
    ].filter(Boolean)),
  );

  const uncoveredCols = numericCols.filter((c) => !coveredColIds.has(c.id));
  if (uncoveredCols.length === 0) return;

  // Determine best chart type deterministically
  let chartType: ChartType;
  let xColumnId: string | undefined;

  if (dateCols.length > 0 && table.rowCount >= 5) {
    chartType = "line";
    xColumnId = dateCols[0].id;
  } else if (table.rowCount <= 10) {
    chartType = "bar";
  } else {
    chartType = "bar";
  }

  const config: VisualizationConfig = {
    xColumnId,
    series: uncoveredCols.map((c) => ({ columnId: c.id, label: c.name })),
    showLegend: uncoveredCols.length > 1,
    showGrid: true,
  };

  const name = `${table.name} — ${uncoveredCols.map((c) => c.name).join(", ")}`;
  const status = mode === "full_auto" ? "active" : "suggested";

  const viz = createVisualization({
    projectId: table.projectId,
    dataTableId: table.id,
    name,
    chartType,
    config,
    status,
    source: "system",
  });

  const eventName = status === "active" ? "visualization.created" : "visualization.suggested";
  emit(eventName, viz);

  console.error(
    `[viz-suggester] ${status === "active" ? "created" : "suggested"} visualization "${name}" for table "${table.name}"`,
  );
}

/**
 * Startup backfill: check all tables with sufficient data for missing visualizations.
 * Called once at agent startup, similar to backfillMissingAutopilotJobs().
 */
export function backfillMissingVisualizations(): void {
  const mode = getAutopilotMode();
  if (mode === "off") return;

  const allTables = listDataTables({});
  let created = 0;

  for (const table of allTables) {
    if (table.rowCount < 5) continue;

    const numericCols = table.columns.filter((c) => c.type === "number");
    if (numericCols.length === 0) continue;

    const existingVizs = listVisualizations({ dataTableId: table.id });
    if (existingVizs.length > 0) continue;

    // No visualizations at all for this table — suggest one
    const dateCols = table.columns.filter((c) => c.type === "date");
    let chartType: ChartType;
    let xColumnId: string | undefined;

    if (dateCols.length > 0) {
      chartType = "line";
      xColumnId = dateCols[0].id;
    } else {
      chartType = "bar";
    }

    const config: VisualizationConfig = {
      xColumnId,
      series: numericCols.map((c) => ({ columnId: c.id, label: c.name })),
      showLegend: numericCols.length > 1,
      showGrid: true,
    };

    const status = mode === "full_auto" ? "active" : "suggested";
    const name = `${table.name} — ${numericCols.map((c) => c.name).join(", ")}`;

    createVisualization({
      projectId: table.projectId,
      dataTableId: table.id,
      name,
      chartType,
      config,
      status,
      source: "system",
    });

    created++;
  }

  if (created > 0) {
    console.error(`[viz-suggester] backfill: created ${created} visualization(s)`);
  }
}

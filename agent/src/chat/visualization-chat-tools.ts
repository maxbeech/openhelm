/**
 * Visualization tool definitions and execution for the AI chat sidebar.
 * Mirrors the MCP visualization-tools.ts pattern but uses the chat ToolDefinition format.
 */

import type { ToolDefinition } from "./tools.js";
import {
  createVisualization,
  listVisualizations,
  updateVisualization,
  deleteVisualization,
} from "../db/queries/visualizations.js";
import { getDataTable, listDataTables } from "../db/queries/data-tables.js";
import { emit } from "../ipc/emitter.js";
import type { ChatToolCall, ChartType, VisualizationConfig, DataTableColumn } from "@openhelm/shared";

interface ToolExecResult {
  callId: string;
  tool: string;
  result: unknown;
  error?: string;
}

export const VISUALIZATION_CHAT_TOOLS: ToolDefinition[] = [
  // ─── Read tools ───
  {
    name: "list_visualizations",
    description: "List chart visualizations, optionally filtered by goal, job, or data table.",
    isWrite: false,
    parameters: {
      goalId: { type: "string", description: "Filter by goal ID" },
      jobId: { type: "string", description: "Filter by job ID" },
      dataTableId: { type: "string", description: "Filter by data table ID" },
    },
  },
  // ─── Write tools ───
  {
    name: "create_visualization",
    description: "Create a chart from a data table. The data table MUST exist first. Use tableName and column names (not IDs). Always create a visualization alongside targets so users can see progress. Types: line (time series), bar (comparison), area (volume), pie (proportions), stat (single KPI).",
    isWrite: true,
    parameters: {
      tableName: { type: "string", description: "Name of the data table to visualize", required: true },
      name: { type: "string", description: "Display name for the chart", required: true },
      chartType: { type: "string", description: "Chart type", required: true, enum: ["line", "bar", "area", "pie", "stat"] },
      xColumnName: { type: "string", description: "Column name for x-axis (for line/bar/area, typically a date column)" },
      yColumnNames: { type: "string", description: "Comma-separated column names for y-axis values (for line/bar/area)" },
      valueColumnName: { type: "string", description: "Value column name (for pie/stat charts)" },
      labelColumnName: { type: "string", description: "Label column name (for pie charts)" },
      aggregation: { type: "string", description: "Aggregation for stat charts: latest, sum, avg, max, min, count" },
      goalId: { type: "string", description: "Associate chart with a goal (use 'pending' to link to most recent create_goal)" },
      jobId: { type: "string", description: "Associate chart with a job" },
    },
  },
  {
    name: "update_visualization",
    description: "Update a chart's name or type.",
    isWrite: true,
    parameters: {
      id: { type: "string", description: "Visualization ID", required: true },
      name: { type: "string", description: "New display name" },
      chartType: { type: "string", description: "New chart type", enum: ["line", "bar", "area", "pie", "stat"] },
    },
  },
  {
    name: "delete_visualization",
    description: "Delete a chart visualization.",
    isWrite: true,
    parameters: {
      id: { type: "string", description: "Visualization ID", required: true },
    },
  },
];

function ok(call: ChatToolCall, result: unknown): ToolExecResult {
  return { callId: call.id, tool: call.tool, result };
}

function fail(call: ChatToolCall, error: string): ToolExecResult {
  console.error(`[chat:tool] ${call.tool} failed: ${error}`);
  return { callId: call.id, tool: call.tool, result: null, error };
}

/** Human-readable one-line summary of a visualization write tool call. */
export function describeVisualizationAction(tool: string, args: Record<string, unknown>): string | null {
  switch (tool) {
    case "create_visualization": return `Create ${args.chartType} chart: "${args.name}"`;
    case "update_visualization": return `Update chart ${args.id}`;
    case "delete_visualization": return `Delete chart ${args.id}`;
    default: return null;
  }
}

/** Execute a visualization read tool. Returns null if not a visualization tool. */
export function executeVisualizationReadTool(
  call: ChatToolCall, projectId: string | undefined,
): ToolExecResult | null {
  const a = call.args;
  try {
    switch (call.tool) {
      case "list_visualizations":
        return ok(call, listVisualizations({
          projectId,
          goalId: a.goalId as string | undefined,
          jobId: a.jobId as string | undefined,
          dataTableId: a.dataTableId as string | undefined,
          status: "active",
        }));
      default: return null;
    }
  } catch (err) {
    return fail(call, err instanceof Error ? err.message : String(err));
  }
}

/** Resolve a column by name from a data table */
function resolveColumn(table: { columns: DataTableColumn[] }, name: string): DataTableColumn | undefined {
  return table.columns.find(
    (c: DataTableColumn) => c.name.toLowerCase() === name.toLowerCase(),
  );
}

/** Execute a visualization write tool. Returns null if not a visualization tool. */
export function executeVisualizationWriteTool(
  call: ChatToolCall, projectId: string | null,
): ToolExecResult | null {
  const a = call.args;
  try {
    switch (call.tool) {
      case "create_visualization": {
        if (!projectId) return fail(call, "Cannot create visualization in All Projects thread");

        // Resolve table by name
        const tables = listDataTables({ projectId });
        const table = tables.find(
          (t) => t.name.toLowerCase() === (a.tableName as string)?.toLowerCase(),
        );
        if (!table) return fail(call, `Data table not found: ${a.tableName}`);

        const chartType = a.chartType as ChartType;
        let config: VisualizationConfig;

        if (chartType === "stat") {
          const valCol = a.valueColumnName ? resolveColumn(table, a.valueColumnName as string) : null;
          config = {
            series: [],
            statColumnId: valCol?.id,
            statAggregation: (a.aggregation as VisualizationConfig["statAggregation"]) ?? "latest",
          };
        } else if (chartType === "pie") {
          const valCol = a.valueColumnName ? resolveColumn(table, a.valueColumnName as string) : null;
          const labelCol = a.labelColumnName ? resolveColumn(table, a.labelColumnName as string) : null;
          config = { series: [], valueColumnId: valCol?.id, labelColumnId: labelCol?.id, showLegend: true };
        } else {
          const xCol = a.xColumnName ? resolveColumn(table, a.xColumnName as string) : null;
          // Parse comma-separated y column names
          const yNames = typeof a.yColumnNames === "string"
            ? (a.yColumnNames as string).split(",").map((s) => s.trim()).filter(Boolean)
            : Array.isArray(a.yColumnNames) ? (a.yColumnNames as string[]) : [];
          const series = yNames.map((yName) => {
            const col = resolveColumn(table, yName);
            return { columnId: col?.id ?? yName, label: col?.name ?? yName };
          });
          config = { xColumnId: xCol?.id, series, showLegend: series.length > 1, showGrid: true };
        }

        const viz = createVisualization({
          projectId,
          dataTableId: table.id,
          name: a.name as string,
          chartType,
          config,
          goalId: a.goalId as string | undefined,
          jobId: a.jobId as string | undefined,
          source: "system",
        });
        emit("visualization.created", viz);
        return ok(call, { id: viz.id, name: viz.name, chartType: viz.chartType });
      }
      case "update_visualization": {
        if (!a.id) return fail(call, "id is required");
        const viz = updateVisualization({
          id: a.id as string,
          ...(a.name !== undefined && { name: a.name as string }),
          ...(a.chartType !== undefined && { chartType: a.chartType as ChartType }),
        });
        emit("visualization.updated", viz);
        return ok(call, { id: viz.id, name: viz.name, chartType: viz.chartType });
      }
      case "delete_visualization": {
        if (!a.id) return fail(call, "id is required");
        const deleted = deleteVisualization(a.id as string);
        if (deleted) emit("visualization.deleted", { id: a.id });
        return ok(call, { deleted });
      }
      default: return null;
    }
  } catch (err) {
    return fail(call, err instanceof Error ? err.message : String(err));
  }
}

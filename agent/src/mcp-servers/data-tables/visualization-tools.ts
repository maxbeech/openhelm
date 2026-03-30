/**
 * MCP tool definitions for visualization CRUD.
 * Allows AI jobs to create, list, update, and delete chart visualizations.
 */

import {
  createVisualization,
  listVisualizations,
  updateVisualization,
  deleteVisualization,
} from "../../db/queries/visualizations.js";
import { getDataTable } from "../../db/queries/data-tables.js";
import type { ChartType, VisualizationConfig, DataTableColumn } from "@openhelm/shared";

export const VISUALIZATION_TOOL_DEFINITIONS = [
  {
    name: "list_visualizations",
    description: "List all chart visualizations for the current project, optionally filtered by goal or job.",
    inputSchema: {
      type: "object" as const,
      properties: {
        goalId: { type: "string", description: "Filter by goal ID" },
        jobId: { type: "string", description: "Filter by job ID" },
        dataTableId: { type: "string", description: "Filter by data table ID" },
      },
    },
  },
  {
    name: "create_visualization",
    description:
      "Create a new chart visualization from a data table. Supports chart types: line, bar, area, pie, stat.",
    inputSchema: {
      type: "object" as const,
      properties: {
        dataTableId: { type: "string", description: "The data table to visualize" },
        name: { type: "string", description: "Display name for the chart" },
        chartType: {
          type: "string",
          description: "Chart type: line, bar, area, pie, or stat",
          enum: ["line", "bar", "area", "pie", "stat"],
        },
        xColumnName: { type: "string", description: "Column name for x-axis (for line/bar/area)" },
        yColumnNames: {
          type: "array",
          items: { type: "string" },
          description: "Column names for y-axis values (for line/bar/area)",
        },
        valueColumnName: { type: "string", description: "Value column name (for pie/stat)" },
        labelColumnName: { type: "string", description: "Label column name (for pie)" },
        aggregation: {
          type: "string",
          description: "Aggregation for stat charts: latest, sum, avg, max, min, count",
        },
        goalId: { type: "string", description: "Associate with a goal" },
        jobId: { type: "string", description: "Associate with a job" },
      },
      required: ["dataTableId", "name", "chartType"],
    },
  },
  {
    name: "update_visualization",
    description: "Update an existing chart visualization's name, type, or configuration.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Visualization ID" },
        name: { type: "string", description: "New display name" },
        chartType: { type: "string", description: "New chart type" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_visualization",
    description: "Delete a chart visualization.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Visualization ID" },
      },
      required: ["id"],
    },
  },
];

export function handleVisualizationToolCall(
  toolName: string,
  args: Record<string, unknown>,
  projectId?: string,
): unknown {
  switch (toolName) {
    case "list_visualizations":
      return handleListVisualizations(args, projectId);
    case "create_visualization":
      return handleCreateVisualization(args, projectId);
    case "update_visualization":
      return handleUpdateVisualization(args);
    case "delete_visualization":
      return handleDeleteVisualization(args);
    default:
      throw new Error(`Unknown visualization tool: ${toolName}`);
  }
}

function handleListVisualizations(args: Record<string, unknown>, projectId?: string) {
  const vizs = listVisualizations({
    projectId: projectId ?? undefined,
    goalId: args.goalId as string | undefined,
    jobId: args.jobId as string | undefined,
    dataTableId: args.dataTableId as string | undefined,
    status: "active",
  });

  return vizs.map((v) => ({
    id: v.id,
    name: v.name,
    chartType: v.chartType,
    dataTableId: v.dataTableId,
    goalId: v.goalId,
    jobId: v.jobId,
  }));
}

function handleCreateVisualization(args: Record<string, unknown>, projectId?: string) {
  if (!projectId) throw new Error("projectId is required to create a visualization");

  const dataTableId = args.dataTableId as string;
  const name = args.name as string;
  const chartType = args.chartType as ChartType;

  const table = getDataTable(dataTableId);
  if (!table) throw new Error(`Data table not found: ${dataTableId}`);

  let config: VisualizationConfig;

  if (chartType === "stat") {
    const valColName = args.valueColumnName as string;
    const valCol = valColName ? table.columns.find(
      (c: DataTableColumn) => c.name.toLowerCase() === valColName.toLowerCase(),
    ) : null;
    config = {
      series: [],
      statColumnId: valCol?.id,
      statAggregation: (args.aggregation as VisualizationConfig["statAggregation"]) ?? "latest",
    };
  } else if (chartType === "pie") {
    const valColName = args.valueColumnName as string;
    const labelColName = args.labelColumnName as string;
    const valCol = valColName ? table.columns.find(
      (c: DataTableColumn) => c.name.toLowerCase() === valColName.toLowerCase(),
    ) : null;
    const labelCol = labelColName ? table.columns.find(
      (c: DataTableColumn) => c.name.toLowerCase() === labelColName.toLowerCase(),
    ) : null;
    config = {
      series: [],
      valueColumnId: valCol?.id,
      labelColumnId: labelCol?.id,
      showLegend: true,
    };
  } else {
    const xColName = args.xColumnName as string;
    const yColNames = (args.yColumnNames as string[]) ?? [];
    const xCol = xColName ? table.columns.find(
      (c: DataTableColumn) => c.name.toLowerCase() === xColName.toLowerCase(),
    ) : null;

    const series = yColNames.map((yName) => {
      const col = table.columns.find(
        (c: DataTableColumn) => c.name.toLowerCase() === yName.toLowerCase(),
      );
      return { columnId: col?.id ?? yName, label: col?.name ?? yName };
    });

    config = {
      xColumnId: xCol?.id,
      series,
      showLegend: series.length > 1,
      showGrid: true,
    };
  }

  const viz = createVisualization({
    projectId,
    dataTableId,
    name,
    chartType,
    config,
    goalId: args.goalId as string | undefined,
    jobId: args.jobId as string | undefined,
    source: "system",
  });

  return { id: viz.id, name: viz.name, chartType: viz.chartType };
}

function handleUpdateVisualization(args: Record<string, unknown>) {
  const id = args.id as string;
  if (!id) throw new Error("id is required");

  const updates: { id: string; name?: string; chartType?: ChartType } = { id };
  if (args.name) updates.name = args.name as string;
  if (args.chartType) updates.chartType = args.chartType as ChartType;

  const viz = updateVisualization(updates);

  return { id: viz.id, name: viz.name, chartType: viz.chartType };
}

function handleDeleteVisualization(args: Record<string, unknown>) {
  const id = args.id as string;
  if (!id) throw new Error("id is required");

  const deleted = deleteVisualization(id);
  return { deleted };
}

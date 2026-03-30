/**
 * MCP tool definitions and handlers for target CRUD + evaluation.
 * Separated from tools.ts to keep files under 225 lines.
 */

import {
  createTarget,
  listTargets,
  updateTarget,
  deleteTarget,
} from "../../db/queries/targets.js";
import {
  evaluateTargets,
} from "../../data-tables/target-evaluator.js";
import { getDataTable, listDataTables } from "../../db/queries/data-tables.js";
import type { Target } from "@openhelm/shared";

// ─── Tool definitions (MCP protocol format) ───

export const TARGET_TOOL_DEFINITIONS = [
  {
    name: "list_targets",
    description:
      "List targets for a goal or job. Targets track numerical progress toward a value in a data table column.",
    inputSchema: {
      type: "object" as const,
      properties: {
        goalId: { type: "string", description: "Filter targets by goal ID" },
        jobId: { type: "string", description: "Filter targets by job ID" },
      },
    },
  },
  {
    name: "create_target",
    description:
      "Create a numerical target linked to a data table column. The target represents a value to reach (or stay under/equal to).",
    inputSchema: {
      type: "object" as const,
      properties: {
        goalId: { type: "string", description: "Goal this target belongs to (provide goalId OR jobId)" },
        jobId: { type: "string", description: "Job this target belongs to (provide goalId OR jobId)" },
        dataTableId: { type: "string", description: "Data table containing the metric" },
        tableName: { type: "string", description: "Table name (alternative to dataTableId)" },
        columnName: { type: "string", description: "Column name in the table" },
        targetValue: { type: "number", description: "Numerical target value to reach" },
        direction: {
          type: "string",
          enum: ["gte", "lte", "eq"],
          description: "Direction: gte (at least), lte (at most), eq (exactly). Default: gte",
        },
        aggregation: {
          type: "string",
          enum: ["latest", "sum", "avg", "max", "min", "count"],
          description: "How to reduce column values: latest row, sum, average, max, min, or count non-null. Default: latest",
        },
        label: { type: "string", description: "Human-readable label for this target" },
        deadline: { type: "string", description: "ISO datetime deadline (optional)" },
      },
      required: ["targetValue"],
    },
  },
  {
    name: "update_target",
    description: "Update an existing target's value, direction, aggregation, label, or deadline.",
    inputSchema: {
      type: "object" as const,
      properties: {
        targetId: { type: "string", description: "Target ID to update" },
        targetValue: { type: "number", description: "New target value" },
        direction: { type: "string", enum: ["gte", "lte", "eq"] },
        aggregation: { type: "string", enum: ["latest", "sum", "avg", "max", "min", "count"] },
        label: { type: "string", description: "New label" },
        deadline: { type: "string", description: "New deadline (ISO datetime or null to clear)" },
      },
      required: ["targetId"],
    },
  },
  {
    name: "delete_target",
    description: "Delete a target.",
    inputSchema: {
      type: "object" as const,
      properties: {
        targetId: { type: "string", description: "Target ID to delete" },
      },
      required: ["targetId"],
    },
  },
  {
    name: "evaluate_targets",
    description:
      "Evaluate current progress for all targets on a goal or job. Returns current values, progress percentages, and whether targets are met.",
    inputSchema: {
      type: "object" as const,
      properties: {
        goalId: { type: "string", description: "Evaluate targets for this goal" },
        jobId: { type: "string", description: "Evaluate targets for this job" },
      },
    },
  },
];

// ─── Tool handler ───

export function handleTargetToolCall(
  toolName: string,
  args: Record<string, unknown>,
  projectId?: string,
): unknown {
  switch (toolName) {
    case "list_targets":
      return handleListTargets(args);
    case "create_target":
      return handleCreateTarget(args, projectId);
    case "update_target":
      return handleUpdateTarget(args);
    case "delete_target":
      return handleDeleteTarget(args);
    case "evaluate_targets":
      return handleEvaluateTargets(args);
    default:
      throw new Error(`Unknown target tool: ${toolName}`);
  }
}

// ─── Handlers ───

function handleListTargets(args: Record<string, unknown>) {
  const targets = listTargets({
    goalId: args.goalId as string | undefined,
    jobId: args.jobId as string | undefined,
  });
  return targets.map(formatTarget);
}

function handleCreateTarget(args: Record<string, unknown>, projectId?: string) {
  if (!projectId) throw new Error("projectId is required");
  if (!args.goalId && !args.jobId) throw new Error("Either goalId or jobId is required");
  if (args.goalId && args.jobId) throw new Error("Provide goalId OR jobId, not both");

  // Resolve table by name if needed
  let dataTableId = args.dataTableId as string | undefined;
  if (!dataTableId && args.tableName) {
    const tables = listDataTables({ projectId });
    const match = tables.find(
      (t) => t.name.toLowerCase() === (args.tableName as string).toLowerCase(),
    );
    if (!match) throw new Error(`Table not found: ${args.tableName}`);
    dataTableId = match.id;
  }
  if (!dataTableId) throw new Error("dataTableId or tableName is required");

  // Resolve column by name
  const table = getDataTable(dataTableId);
  if (!table) throw new Error(`Table not found: ${dataTableId}`);

  let columnId: string | undefined;
  if (args.columnName) {
    const col = table.columns.find(
      (c) => c.name.toLowerCase() === (args.columnName as string).toLowerCase(),
    );
    if (!col) throw new Error(`Column "${args.columnName}" not found in table "${table.name}"`);
    columnId = col.id;
  }
  if (!columnId) throw new Error("columnName is required");

  const target = createTarget({
    goalId: args.goalId as string | undefined,
    jobId: args.jobId as string | undefined,
    projectId,
    dataTableId,
    columnId,
    targetValue: args.targetValue as number,
    direction: (args.direction as Target["direction"]) ?? "gte",
    aggregation: (args.aggregation as Target["aggregation"]) ?? "latest",
    label: args.label as string | undefined,
    deadline: args.deadline as string | undefined,
    createdBy: "ai",
  });

  return formatTarget(target);
}

function handleUpdateTarget(args: Record<string, unknown>) {
  const targetId = args.targetId as string;
  if (!targetId) throw new Error("targetId is required");

  const target = updateTarget({
    id: targetId,
    ...(args.targetValue !== undefined && { targetValue: args.targetValue as number }),
    ...(args.direction !== undefined && { direction: args.direction as Target["direction"] }),
    ...(args.aggregation !== undefined && { aggregation: args.aggregation as Target["aggregation"] }),
    ...(args.label !== undefined && { label: args.label as string | null }),
    ...(args.deadline !== undefined && { deadline: args.deadline as string | null }),
  });

  return formatTarget(target);
}

function handleDeleteTarget(args: Record<string, unknown>) {
  const targetId = args.targetId as string;
  if (!targetId) throw new Error("targetId is required");
  const deleted = deleteTarget(targetId);
  return { deleted, targetId };
}

function handleEvaluateTargets(args: Record<string, unknown>) {
  const targets = listTargets({
    goalId: args.goalId as string | undefined,
    jobId: args.jobId as string | undefined,
  });

  if (targets.length === 0) return { targets: [], message: "No targets found" };

  const evaluations = evaluateTargets(targets);
  return {
    targets: evaluations.map((e) => ({
      targetId: e.targetId,
      label: e.label,
      currentValue: e.currentValue,
      targetValue: e.targetValue,
      direction: e.direction,
      progress: `${Math.round(e.progress * 100)}%`,
      met: e.met,
      rowCount: e.rowCount,
      deadline: e.deadline,
      isOverdue: e.isOverdue,
    })),
  };
}

function formatTarget(t: Target) {
  return {
    id: t.id,
    goalId: t.goalId,
    jobId: t.jobId,
    dataTableId: t.dataTableId,
    columnId: t.columnId,
    targetValue: t.targetValue,
    direction: t.direction,
    aggregation: t.aggregation,
    label: t.label,
    deadline: t.deadline,
    createdBy: t.createdBy,
  };
}

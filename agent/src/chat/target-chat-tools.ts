/**
 * Target tool definitions and execution for the AI chat sidebar.
 * Mirrors the MCP target-tools.ts pattern but uses the chat ToolDefinition format.
 */

import type { ToolDefinition } from "./tools.js";
import {
  createTarget,
  listTargets,
  updateTarget,
  deleteTarget,
} from "../db/queries/targets.js";
import { evaluateTargets } from "../data-tables/target-evaluator.js";
import { getDataTable, listDataTables } from "../db/queries/data-tables.js";
import { emit } from "../ipc/emitter.js";
import type { ChatToolCall, Target } from "@openhelm/shared";

interface ToolExecResult {
  callId: string;
  tool: string;
  result: unknown;
  error?: string;
}

export const TARGET_CHAT_TOOLS: ToolDefinition[] = [
  // ─── Read tools ───
  {
    name: "list_targets",
    description: "List numerical targets for a goal or job. Targets track progress toward a value in a data table column.",
    isWrite: false,
    parameters: {
      goalId: { type: "string", description: "Filter targets by goal ID" },
      jobId: { type: "string", description: "Filter targets by job ID" },
    },
  },
  {
    name: "evaluate_targets",
    description: "Evaluate current progress for all targets on a goal or job. Returns current values, progress %, and met status.",
    isWrite: false,
    parameters: {
      goalId: { type: "string", description: "Evaluate targets for this goal" },
      jobId: { type: "string", description: "Evaluate targets for this job" },
    },
  },
  // ─── Write tools ───
  {
    name: "create_target",
    description: "Create a numerical target linked to a data table column. The data table MUST exist first (create it with create_data_table if needed). Use tableName and columnName (not IDs). A scheduled job should populate the data table so the target can track progress.",
    isWrite: true,
    parameters: {
      goalId: { type: "string", description: "Goal this target belongs to (use 'pending' to link to the most recent create_goal)" },
      jobId: { type: "string", description: "Job this target belongs to (provide goalId OR jobId, not both)" },
      tableName: { type: "string", description: "Name of the data table containing the metric", required: true },
      columnName: { type: "string", description: "Column name in the table (must be a number type)", required: true },
      targetValue: { type: "number", description: "Numerical target value to reach", required: true },
      direction: { type: "string", description: "gte (at least), lte (at most), eq (exactly). Default: gte", enum: ["gte", "lte", "eq"] },
      aggregation: { type: "string", description: "How to reduce column values: latest, sum, avg, max, min, count. Default: latest", enum: ["latest", "sum", "avg", "max", "min", "count"] },
      label: { type: "string", description: "Human-readable label (e.g. 'Reach 50 DAUs')" },
      deadline: { type: "string", description: "ISO datetime deadline (optional)" },
    },
  },
  {
    name: "update_target",
    description: "Update a target's value, direction, aggregation, label, or deadline.",
    isWrite: true,
    parameters: {
      targetId: { type: "string", description: "Target ID", required: true },
      targetValue: { type: "number", description: "New target value" },
      direction: { type: "string", description: "gte/lte/eq", enum: ["gte", "lte", "eq"] },
      aggregation: { type: "string", description: "latest/sum/avg/max/min/count", enum: ["latest", "sum", "avg", "max", "min", "count"] },
      label: { type: "string", description: "New label" },
      deadline: { type: "string", description: "New deadline (ISO datetime)" },
    },
  },
  {
    name: "delete_target",
    description: "Delete a target.",
    isWrite: true,
    parameters: {
      targetId: { type: "string", description: "Target ID", required: true },
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

/** Human-readable one-line summary of a target write tool call. */
export function describeTargetAction(tool: string, args: Record<string, unknown>): string | null {
  switch (tool) {
    case "create_target": {
      const label = args.label ?? `${args.columnName} ${args.direction ?? "≥"} ${args.targetValue}`;
      return `Create target: ${label}`;
    }
    case "update_target": return `Update target ${args.targetId}`;
    case "delete_target": return `Delete target ${args.targetId}`;
    default: return null;
  }
}

/** Execute a target read tool. Returns null if not a target tool. */
export function executeTargetReadTool(call: ChatToolCall, projectId: string | undefined): ToolExecResult | null {
  const a = call.args;
  try {
    switch (call.tool) {
      case "list_targets":
        return ok(call, listTargets({
          goalId: a.goalId as string | undefined,
          jobId: a.jobId as string | undefined,
          projectId,
        }));
      case "evaluate_targets": {
        const targets = listTargets({
          goalId: a.goalId as string | undefined,
          jobId: a.jobId as string | undefined,
          projectId,
        });
        if (targets.length === 0) return ok(call, { targets: [], message: "No targets found" });
        const evaluations = evaluateTargets(targets);
        return ok(call, evaluations.map((e) => ({
          targetId: e.targetId, label: e.label, currentValue: e.currentValue,
          targetValue: e.targetValue, direction: e.direction,
          progress: `${Math.round(e.progress * 100)}%`,
          met: e.met, rowCount: e.rowCount, deadline: e.deadline, isOverdue: e.isOverdue,
        })));
      }
      default: return null;
    }
  } catch (err) {
    return fail(call, err instanceof Error ? err.message : String(err));
  }
}

/** Execute a target write tool. Returns null if not a target tool. */
export function executeTargetWriteTool(call: ChatToolCall, projectId: string | null): ToolExecResult | null {
  const a = call.args;
  try {
    switch (call.tool) {
      case "create_target": {
        if (!projectId) return fail(call, "Cannot create target in All Projects thread");
        if (!a.goalId && !a.jobId) return fail(call, "Either goalId or jobId is required");

        // Resolve table by name
        const tables = listDataTables({ projectId });
        const table = tables.find(
          (t) => t.name.toLowerCase() === (a.tableName as string)?.toLowerCase(),
        );
        if (!table) return fail(call, `Data table not found: ${a.tableName}`);

        // Resolve column by name
        const col = table.columns.find(
          (c) => c.name.toLowerCase() === (a.columnName as string)?.toLowerCase(),
        );
        if (!col) return fail(call, `Column "${a.columnName}" not found in table "${table.name}"`);

        const target = createTarget({
          goalId: a.goalId as string | undefined,
          jobId: a.jobId as string | undefined,
          projectId,
          dataTableId: table.id,
          columnId: col.id,
          targetValue: a.targetValue as number,
          direction: (a.direction as Target["direction"]) ?? "gte",
          aggregation: (a.aggregation as Target["aggregation"]) ?? "latest",
          label: a.label as string | undefined,
          deadline: a.deadline as string | undefined,
          createdBy: "ai",
        });
        emit("target.created", target);
        return ok(call, target);
      }
      case "update_target": {
        if (!a.targetId) return fail(call, "targetId is required");
        const target = updateTarget({
          id: a.targetId as string,
          ...(a.targetValue !== undefined && { targetValue: a.targetValue as number }),
          ...(a.direction !== undefined && { direction: a.direction as Target["direction"] }),
          ...(a.aggregation !== undefined && { aggregation: a.aggregation as Target["aggregation"] }),
          ...(a.label !== undefined && { label: a.label as string }),
          ...(a.deadline !== undefined && { deadline: a.deadline as string }),
        });
        emit("target.updated", target);
        return ok(call, target);
      }
      case "delete_target": {
        if (!a.targetId) return fail(call, "targetId is required");
        const deleted = deleteTarget(a.targetId as string);
        if (deleted) emit("target.deleted", { id: a.targetId });
        return ok(call, { deleted });
      }
      default: return null;
    }
  } catch (err) {
    return fail(call, err instanceof Error ? err.message : String(err));
  }
}

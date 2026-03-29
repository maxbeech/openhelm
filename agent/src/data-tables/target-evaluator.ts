import { getDataTable, getDataTableRows } from "../db/queries/data-tables.js";
import type {
  Target,
  TargetEvaluation,
  TargetDirection,
} from "@openhelm/shared";

/**
 * Extract numeric values from a column across all rows.
 * Non-numeric / null values are silently skipped.
 */
function extractColumnValues(
  rows: { data: Record<string, unknown> }[],
  columnId: string,
): number[] {
  const values: number[] = [];
  for (const row of rows) {
    const raw = row.data[columnId];
    if (raw == null) continue;
    const num = Number(raw);
    if (!Number.isNaN(num)) values.push(num);
  }
  return values;
}

/** Aggregate numeric values according to the chosen method. */
function aggregate(
  values: number[],
  method: Target["aggregation"],
  rows: { data: Record<string, unknown>; sortOrder: number; createdAt: string }[],
  columnId: string,
): number | null {
  if (method === "count") return values.length;
  if (values.length === 0) return null;

  switch (method) {
    case "latest": {
      // Find the row with the highest sortOrder (then latest createdAt)
      let best: { val: number; sort: number; ts: string } | null = null;
      for (const row of rows) {
        const raw = row.data[columnId];
        if (raw == null) continue;
        const num = Number(raw);
        if (Number.isNaN(num)) continue;
        if (
          !best ||
          row.sortOrder > best.sort ||
          (row.sortOrder === best.sort && row.createdAt > best.ts)
        ) {
          best = { val: num, sort: row.sortOrder, ts: row.createdAt };
        }
      }
      return best?.val ?? null;
    }
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "max":
      return Math.max(...values);
    case "min":
      return Math.min(...values);
    default:
      return null;
  }
}

/** Compute progress as 0–1 ratio. */
function computeProgress(
  current: number | null,
  target: number,
  direction: TargetDirection,
): number {
  if (current == null) return 0;

  switch (direction) {
    case "gte":
      if (target === 0) return current >= 0 ? 1 : 0;
      return Math.max(0, Math.min(1, current / target));
    case "lte":
      if (current <= target) return 1;
      if (current === 0) return 1;
      return Math.max(0, Math.min(1, target / current));
    case "eq": {
      const denom = Math.max(Math.abs(target), 1);
      return Math.max(0, 1 - Math.min(1, Math.abs(current - target) / denom));
    }
    default:
      return 0;
  }
}

/** Check if a target's value has been met. */
function isMet(current: number | null, target: number, direction: TargetDirection): boolean {
  if (current == null) return false;
  switch (direction) {
    case "gte": return current >= target;
    case "lte": return current <= target;
    case "eq": return current === target;
    default: return false;
  }
}

/** Evaluate a single target against its data table. */
export function evaluateTarget(target: Target): TargetEvaluation {
  const table = getDataTable(target.dataTableId);
  if (!table) {
    return buildNullEval(target);
  }

  // Check column still exists
  const colExists = table.columns.some((c) => c.id === target.columnId);
  if (!colExists) {
    return buildNullEval(target);
  }

  // Fetch all rows (up to 10000 for aggregation)
  const rows = getDataTableRows({ tableId: target.dataTableId, limit: 10000 });
  const values = extractColumnValues(rows, target.columnId);
  const currentValue = aggregate(values, target.aggregation, rows, target.columnId);
  const met = isMet(currentValue, target.targetValue, target.direction);
  const progress = computeProgress(currentValue, target.targetValue, target.direction);
  const isOverdue = !!target.deadline && !met && new Date(target.deadline) < new Date();

  return {
    targetId: target.id,
    currentValue,
    targetValue: target.targetValue,
    direction: target.direction,
    met,
    progress,
    rowCount: rows.length,
    label: target.label,
    deadline: target.deadline,
    isOverdue,
  };
}

/** Evaluate multiple targets. */
export function evaluateTargets(targetList: Target[]): TargetEvaluation[] {
  return targetList.map(evaluateTarget);
}


function buildNullEval(target: Target): TargetEvaluation {
  return {
    targetId: target.id,
    currentValue: null,
    targetValue: target.targetValue,
    direction: target.direction,
    met: false,
    progress: 0,
    rowCount: 0,
    label: target.label,
    deadline: target.deadline,
    isOverdue: !!target.deadline && new Date(target.deadline) < new Date(),
  };
}

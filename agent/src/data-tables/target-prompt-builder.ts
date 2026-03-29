/**
 * Builds a markdown section describing active targets and their progress,
 * for injection into job prompts so Claude Code is aware of target state.
 */

import type { Target, TargetEvaluation } from "@openhelm/shared";
import { evaluateTargets } from "./target-evaluator.js";
import { getDataTable } from "../db/queries/data-tables.js";

const DIRECTION_LABELS: Record<Target["direction"], string> = {
  gte: "\u2265",
  lte: "\u2264",
  eq: "=",
};

/**
 * Build an "## Active Targets" section for prompt injection.
 * Returns empty string if no targets provided.
 */
export function buildTargetSection(targets: Target[]): string {
  if (targets.length === 0) return "";

  const evaluations = evaluateTargets(targets);
  const lines: string[] = ["\n\n## Active Targets\n"];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const ev = evaluations[i];
    lines.push(formatTargetLine(target, ev));
  }

  return lines.join("\n");
}

function formatTargetLine(target: Target, ev: TargetEvaluation): string {
  const label = target.label ?? resolveColumnName(target) ?? "Target";
  const dir = DIRECTION_LABELS[target.direction];
  const pct = Math.round(ev.progress * 100);
  const current = ev.currentValue != null ? ev.currentValue : "no data";
  const status = ev.met ? "MET" : ev.isOverdue ? "OVERDUE" : "";

  let line = `- **${label}** \u2192 Target: ${dir}${target.targetValue} (Current: ${current}, Progress: ${pct}%)`;
  if (target.deadline) {
    line += ` \u2014 Deadline: ${target.deadline.slice(0, 10)}`;
  }
  if (status) {
    line += ` \u2014 ${status}`;
  }
  return line;
}

/** Try to resolve the column name from the data table for display. */
function resolveColumnName(target: Target): string | null {
  try {
    const table = getDataTable(target.dataTableId);
    if (!table) return null;
    const col = table.columns.find((c) => c.id === target.columnId);
    if (!col) return null;
    return `${col.name} (${table.name})`;
  } catch {
    return null;
  }
}

/**
 * Rollup aggregation evaluator for data table rollup columns.
 *
 * Given a set of related rows and a target column, computes the
 * aggregation result based on the configured function.
 */

import type { RollupAggregation } from "./index.js";

/** Compute a rollup aggregation over values from related rows. */
export function computeRollup(
  aggregation: RollupAggregation,
  values: unknown[],
): unknown {
  switch (aggregation) {
    case "count":
      return values.length;

    case "count_values":
      return values.filter((v) => v !== null && v !== undefined && v !== "").length;

    case "count_unique":
      return new Set(values.filter((v) => v !== null && v !== undefined).map(String)).size;

    case "sum":
      return values.reduce<number>((acc, v) => acc + toNum(v), 0);

    case "average": {
      const nums = values.filter((v) => v !== null && v !== undefined && v !== "").map(toNum).filter((n) => !isNaN(n));
      return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length;
    }

    case "min": {
      const nums = values.filter((v) => v !== null && v !== undefined && v !== "").map(toNum).filter((n) => !isNaN(n));
      return nums.length === 0 ? null : Math.min(...nums);
    }

    case "max": {
      const nums = values.filter((v) => v !== null && v !== undefined && v !== "").map(toNum).filter((n) => !isNaN(n));
      return nums.length === 0 ? null : Math.max(...nums);
    }

    case "percent_empty": {
      if (values.length === 0) return null;
      const empty = values.filter((v) => v === null || v === undefined || v === "").length;
      return Math.round((empty / values.length) * 100);
    }

    case "percent_not_empty": {
      if (values.length === 0) return null;
      const filled = values.filter((v) => v !== null && v !== undefined && v !== "").length;
      return Math.round((filled / values.length) * 100);
    }

    case "show_original":
      return values;

    default:
      return null;
  }
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

import type { DataTableColumn, RollupAggregation } from "@openhelm/shared";
import { computeRollup } from "@openhelm/shared";
import type { RelatedTableData } from "./relation-cell";

interface RollupCfg {
  relationColumnId?: string;
  sourceColumnId?: string;
  aggregation?: RollupAggregation;
}

interface Props {
  column: DataTableColumn;
  /** The relation column value (array of related row IDs) from the same row */
  relationValue: unknown;
  relatedData: Map<string, RelatedTableData>;
  allColumns: DataTableColumn[];
}

export function RollupCell({ column, relationValue, relatedData, allColumns }: Props) {
  const config = column.config as RollupCfg;
  if (!config.relationColumnId) {
    return <EmptyCell label="No relation configured" />;
  }

  // Find the relation column to get target table ID
  const relCol = allColumns.find((c) => c.id === config.relationColumnId);
  if (!relCol || relCol.type !== "relation") {
    return <EmptyCell label="Invalid relation" />;
  }

  const targetTableId = (relCol.config as { targetTableId?: string }).targetTableId ?? "";
  const related = relatedData.get(targetTableId);
  if (!related) {
    return <EmptyCell label="-" />;
  }

  const aggregation = config.aggregation ?? "count";

  // Get related row IDs from the relation column value
  const relatedIds = Array.isArray(relationValue) ? relationValue as string[] : [];
  if (relatedIds.length === 0) {
    return <EmptyCell label={aggregation === "count" ? "0" : "-"} />;
  }

  // Collect values from the source column of related rows
  const values: unknown[] = [];
  for (const rowId of relatedIds) {
    const row = related.rows.find((r) => r.id === rowId);
    if (row && config.sourceColumnId) {
      values.push(row.data[config.sourceColumnId] ?? null);
    }
  }

  const result = computeRollup(aggregation, values);

  return (
    <div className="min-h-[30px] px-3 py-1.5 text-sm text-muted-foreground truncate" title={formatResult(result, aggregation)}>
      {formatResult(result, aggregation)}
    </div>
  );
}

function formatResult(result: unknown, aggregation: RollupAggregation): string {
  if (result === null || result === undefined) return "-";
  if (Array.isArray(result)) return result.map((v) => String(v ?? "")).join(", ");
  if (typeof result === "number") {
    if (aggregation === "percent_empty" || aggregation === "percent_not_empty") return `${result}%`;
    if (aggregation === "average") return result.toFixed(2);
    return String(result);
  }
  return String(result);
}

function EmptyCell({ label }: { label: string }) {
  return (
    <div className="min-h-[30px] px-3 py-1.5 text-sm text-muted-foreground/50 truncate">
      {label}
    </div>
  );
}

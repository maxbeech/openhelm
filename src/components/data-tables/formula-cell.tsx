import type { DataTableColumn } from "@openhelm/shared";
import { evaluateFormula } from "@openhelm/shared";

interface Props {
  column: DataTableColumn;
  rowData: Record<string, unknown>;
  allColumns: DataTableColumn[];
}

export function FormulaCell({ column, rowData, allColumns }: Props) {
  const config = column.config as { expression?: string };
  if (!config.expression) {
    return (
      <div className="min-h-[30px] px-3 py-1.5 text-sm text-muted-foreground/50">
        No formula
      </div>
    );
  }

  // Build column name → ID mapping (lowercased for case-insensitive prop() lookup)
  const colNameToId: Record<string, string> = {};
  for (const col of allColumns) {
    colNameToId[col.name.toLowerCase()] = col.id;
  }

  const result = evaluateFormula(config.expression, rowData, colNameToId);

  return (
    <div
      className="min-h-[30px] px-3 py-1.5 text-sm text-muted-foreground truncate"
      title={formatValue(result)}
    >
      {formatValue(result)}
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (value === "#ERROR" || value === "#DIV/0") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(2);
  }
  return String(value);
}

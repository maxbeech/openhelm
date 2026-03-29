import { Trash2 } from "lucide-react";
import type { DataTableColumn, DataTableRow } from "@openhelm/shared";
import { ColumnTypeIcon } from "./column-type-icon";
import { DataTableCell } from "./data-table-cell";

interface Props {
  columns: DataTableColumn[];
  rows: DataTableRow[];
  loading: boolean;
  onCellChange: (rowId: string, columnId: string, value: unknown) => void;
  onDeleteRow: (rowId: string) => void;
  onColumnRemove: (columnId: string) => void;
  onColumnConfigUpdate: (columnId: string, config: Record<string, unknown>) => void;
}

export function DataTableGrid({ columns, rows, loading, onCellChange, onDeleteRow, onColumnRemove, onColumnConfigUpdate }: Props) {
  if (loading && rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        Loading rows...
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        Add a column to get started.
      </div>
    );
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-border bg-muted/30">
          <th className="w-8 px-1 py-2 text-center text-[10px] text-muted-foreground/50">#</th>
          {columns.map((col) => (
            <th
              key={col.id}
              className="group min-w-[120px] border-r border-border/50 px-3 py-2 text-left text-xs font-medium text-muted-foreground"
            >
              <div className="flex items-center gap-1.5">
                <ColumnTypeIcon type={col.type} className="size-3 shrink-0" />
                <span className="truncate">{col.name}</span>
                <button
                  onClick={() => onColumnRemove(col.id)}
                  className="ml-auto flex size-4 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
                  title="Remove column"
                >
                  <Trash2 className="size-2.5" />
                </button>
              </div>
            </th>
          ))}
          <th className="w-8" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={row.id} className="group border-b border-border/30 hover:bg-accent/20">
            <td className="px-1 py-1.5 text-center text-[10px] text-muted-foreground/40">
              {idx + 1}
            </td>
            {columns.map((col) => (
              <td key={col.id} className="border-r border-border/30 px-0 py-0">
                <DataTableCell
                  column={col}
                  value={row.data[col.id]}
                  onChange={(value) => onCellChange(row.id, col.id, value)}
                  onColumnConfigUpdate={(config) => onColumnConfigUpdate(col.id, config)}
                />
              </td>
            ))}
            <td className="px-1 py-1.5">
              <button
                onClick={() => onDeleteRow(row.id)}
                className="flex size-5 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
                title="Delete row"
              >
                <Trash2 className="size-3" />
              </button>
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={columns.length + 2} className="px-3 py-8 text-center text-xs text-muted-foreground">
              No rows yet. Click "+ Row" to add data.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

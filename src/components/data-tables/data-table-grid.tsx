import { useMemo } from "react";
import { Trash2 } from "lucide-react";
import type { DataTableColumn, DataTableRow } from "@openhelm/shared";
import { DataTableCell } from "./data-table-cell";
import { DataTableGridHeader } from "./data-table-grid-header";
import type { SortState } from "./data-table-sort";
import { sortRows } from "./data-table-sort";
import type { RelatedTableData } from "./relation-cell";

const DEFAULT_WIDTH = 180;

interface Props {
  columns: DataTableColumn[];
  rows: DataTableRow[];
  loading: boolean;
  sortState: SortState | null;
  onSortChange: (next: SortState | null) => void;
  onCellChange: (rowId: string, columnId: string, value: unknown) => void;
  onDeleteRow: (rowId: string) => void;
  onColumnRemove: (columnId: string) => void;
  onColumnConfigUpdate: (columnId: string, config: Record<string, unknown>) => void;
  onColumnResize: (columnId: string, width: number) => void;
  onColumnsReorder: (nextColumnIds: string[]) => void;
  relatedData?: Map<string, RelatedTableData>;
}

export function DataTableGrid({
  columns,
  rows,
  loading,
  sortState,
  onSortChange,
  onCellChange,
  onDeleteRow,
  onColumnRemove,
  onColumnConfigUpdate,
  onColumnResize,
  onColumnsReorder,
  relatedData,
}: Props) {
  const displayedRows = useMemo(
    () => sortRows(rows, columns, sortState),
    [rows, columns, sortState],
  );

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
    <table className="border-collapse text-sm" style={{ tableLayout: "fixed" }}>
      <DataTableGridHeader
        columns={columns}
        sortState={sortState}
        onSortChange={onSortChange}
        onColumnRemove={onColumnRemove}
        onColumnResize={onColumnResize}
        onColumnsReorder={onColumnsReorder}
      />
      <tbody>
        {displayedRows.map((row, idx) => (
          <tr key={row.id} className="group border-b border-border/30 hover:bg-accent/20">
            <td className="w-8 px-1 py-1.5 text-center text-3xs text-muted-foreground/40">
              {idx + 1}
            </td>
            {columns.map((col) => {
              const width = col.width ?? DEFAULT_WIDTH;
              return (
                <td
                  key={col.id}
                  style={{ width, minWidth: width, maxWidth: width }}
                  className="overflow-hidden border-r border-border/30 px-0 py-0 align-top"
                >
                  <DataTableCell
                    column={col}
                    value={row.data[col.id]}
                    onChange={(value) => onCellChange(row.id, col.id, value)}
                    onColumnConfigUpdate={(config) => onColumnConfigUpdate(col.id, config)}
                    relatedData={relatedData}
                    row={row}
                    allColumns={columns}
                  />
                </td>
              );
            })}
            <td className="w-8 px-1 py-1.5">
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

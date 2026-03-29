import { useEffect, useState, useCallback } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useDataTableStore } from "@/stores/data-table-store";
import * as api from "@/lib/api";
import type { DataTable, DataTableColumn, DataTableColumnType } from "@openhelm/shared";
import { DataTableGrid } from "./data-table-grid";
import { DataTableAddColumn } from "./data-table-add-column";

interface Props {
  tableId: string;
}

export function DataTableDetailView({ tableId }: Props) {
  const { setContentView } = useAppStore();
  const { currentRows, rowsLoading, fetchRows, insertRows, deleteRows, updateRow } = useDataTableStore();
  const [table, setTable] = useState<DataTable | null>(null);
  const [showAddColumn, setShowAddColumn] = useState(false);

  // Fetch table metadata and rows
  useEffect(() => {
    api.getDataTable(tableId).then(setTable).catch(console.error);
    fetchRows(tableId);
  }, [tableId, fetchRows]);

  const handleAddRow = useCallback(async () => {
    if (!table) return;
    const emptyRow: Record<string, unknown> = {};
    for (const col of table.columns) {
      emptyRow[col.id] = col.type === "checkbox" ? false : null;
    }
    await insertRows(tableId, [emptyRow]);
    // Refresh table metadata for row count
    api.getDataTable(tableId).then(setTable).catch(console.error);
  }, [table, tableId, insertRows]);

  const handleCellChange = useCallback(async (rowId: string, columnId: string, value: unknown) => {
    await updateRow(rowId, { [columnId]: value });
    // Update local rows immediately for responsive UI
    fetchRows(tableId);
  }, [updateRow, fetchRows, tableId]);

  const handleDeleteRow = useCallback(async (rowId: string) => {
    await deleteRows([rowId]);
    fetchRows(tableId);
    api.getDataTable(tableId).then(setTable).catch(console.error);
  }, [deleteRows, fetchRows, tableId]);

  const handleColumnAdded = useCallback(async (name: string, type: DataTableColumnType) => {
    const column: DataTableColumn = {
      id: `col_${crypto.randomUUID().slice(0, 8)}`,
      name,
      type,
      config: {},
    };
    await api.addDataTableColumn({ tableId, column });
    api.getDataTable(tableId).then(setTable).catch(console.error);
    setShowAddColumn(false);
  }, [tableId]);

  const handleColumnRemove = useCallback(async (columnId: string) => {
    await api.removeDataTableColumn({ tableId, columnId });
    api.getDataTable(tableId).then(setTable).catch(console.error);
  }, [tableId]);

  const handleColumnConfigUpdate = useCallback(async (columnId: string, config: Record<string, unknown>) => {
    const updated = await api.updateDataTableColumnConfig({ tableId, columnId, config });
    setTable(updated);
  }, [tableId]);

  if (!table) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          onClick={() => setContentView("data-tables")}
          className="flex size-7 items-center justify-center rounded hover:bg-accent transition-colors"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold truncate">{table.name}</h2>
          {table.description && (
            <p className="text-[10px] text-muted-foreground truncate">{table.description}</p>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">{table.rowCount} rows</span>
        <button
          onClick={() => setShowAddColumn(true)}
          className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Plus className="size-3" />
          Column
        </button>
        <button
          onClick={handleAddRow}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="size-3" />
          Row
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        <DataTableGrid
          columns={table.columns}
          rows={currentRows}
          loading={rowsLoading}
          onCellChange={handleCellChange}
          onDeleteRow={handleDeleteRow}
          onColumnRemove={handleColumnRemove}
          onColumnConfigUpdate={handleColumnConfigUpdate}
        />
      </div>

      {/* Add column popover */}
      {showAddColumn && (
        <DataTableAddColumn
          onAdd={handleColumnAdded}
          onClose={() => setShowAddColumn(false)}
        />
      )}
    </div>
  );
}

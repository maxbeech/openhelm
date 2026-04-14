import { useEffect, useState, useCallback } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useDataTableStore } from "@/stores/data-table-store";
import * as api from "@/lib/api";
import type { DataTable, DataTableColumn, DataTableColumnType } from "@openhelm/shared";
import type { RelatedTableData } from "./relation-cell";
import { DataTableGrid } from "./data-table-grid";
import { DataTableAddColumn } from "./data-table-add-column";
import { useDataTableColumns } from "./use-data-table-columns";
import type { SortState } from "./data-table-sort";
import { loadSortState, saveSortState } from "./data-table-sort";

interface Props {
  tableId: string;
}

export function DataTableDetailView({ tableId }: Props) {
  const { setContentView } = useAppStore();
  const { currentRows, rowsLoading, fetchRows, insertRows, deleteRows, updateRow } = useDataTableStore();
  const [table, setTable] = useState<DataTable | null>(null);
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [projectTables, setProjectTables] = useState<DataTable[]>([]);
  const [relatedData, setRelatedData] = useState<Map<string, RelatedTableData>>(new Map());
  // Sort state is persisted per-table in localStorage.
  const [sortState, setSortState] = useState<SortState | null>(() => loadSortState(tableId));

  // When the tableId changes (navigating between tables), reload the persisted sort for that table.
  useEffect(() => {
    setSortState(loadSortState(tableId));
  }, [tableId]);

  const handleSortChange = useCallback(
    (next: SortState | null) => {
      setSortState(next);
      saveSortState(tableId, next);
    },
    [tableId],
  );

  // Fetch table metadata, rows, and project tables
  useEffect(() => {
    api.getDataTable(tableId).then(setTable).catch(console.error);
    fetchRows(tableId);
  }, [tableId, fetchRows]);

  // Fetch project tables for relation column picker
  useEffect(() => {
    if (!table) return;
    api.listDataTables({ projectId: table.projectId }).then(setProjectTables).catch(console.error);
  }, [table?.projectId]);

  // Prefetch target table data for relation and rollup columns
  const fetchRelatedData = useCallback(async (columns: DataTableColumn[]) => {
    const targetIds = new Set<string>();
    for (const col of columns) {
      if (col.type === "relation") {
        const tid = (col.config as { targetTableId?: string }).targetTableId;
        if (tid) targetIds.add(tid);
      }
      if (col.type === "rollup") {
        // Rollup needs the target table of its source relation
        const cfg = col.config as { relationColumnId?: string };
        if (cfg.relationColumnId) {
          const relCol = columns.find((c) => c.id === cfg.relationColumnId);
          if (relCol) {
            const tid = (relCol.config as { targetTableId?: string }).targetTableId;
            if (tid) targetIds.add(tid);
          }
        }
      }
    }
    if (targetIds.size === 0) {
      setRelatedData(new Map());
      return;
    }

    const entries: [string, RelatedTableData][] = [];
    for (const tid of targetIds) {
      try {
        // If target is current table, reuse current rows
        if (tid === tableId && table) {
          entries.push([tid, { table, rows: currentRows }]);
          continue;
        }
        const [targetTable, targetRows] = await Promise.all([
          api.getDataTable(tid),
          api.listDataTableRows({ tableId: tid, limit: 200 }),
        ]);
        if (targetTable) entries.push([tid, { table: targetTable, rows: targetRows }]);
      } catch {
        // Target table may have been deleted; skip
      }
    }
    setRelatedData(new Map(entries));
  }, [tableId, table, currentRows]);

  useEffect(() => {
    if (table) fetchRelatedData(table.columns);
  }, [table?.columns, fetchRelatedData]);

  const columnOps = useDataTableColumns(tableId, table, setTable);

  const handleAddRow = useCallback(async () => {
    if (!table) return;
    const emptyRow: Record<string, unknown> = {};
    for (const col of table.columns) {
      emptyRow[col.id] = col.type === "checkbox" ? false : null;
    }
    await insertRows(tableId, [emptyRow]);
    api.getDataTable(tableId).then(setTable).catch(console.error);
  }, [table, tableId, insertRows]);

  const handleCellChange = useCallback(async (rowId: string, columnId: string, value: unknown) => {
    await updateRow(rowId, { [columnId]: value });
    fetchRows(tableId);
  }, [updateRow, fetchRows, tableId]);

  const handleDeleteRow = useCallback(async (rowId: string) => {
    await deleteRows([rowId]);
    fetchRows(tableId);
    api.getDataTable(tableId).then(setTable).catch(console.error);
  }, [deleteRows, fetchRows, tableId]);

  const handleColumnAdded = useCallback(
    async (name: string, type: DataTableColumnType, config?: Record<string, unknown>) => {
      await columnOps.addColumn(name, type, config);
      setShowAddColumn(false);
    },
    [columnOps],
  );

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
            <p className="text-3xs text-muted-foreground truncate">{table.description}</p>
          )}
        </div>
        <span className="text-3xs text-muted-foreground">{currentRows.length} rows</span>
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
          sortState={sortState}
          onSortChange={handleSortChange}
          onCellChange={handleCellChange}
          onDeleteRow={handleDeleteRow}
          onColumnRemove={columnOps.removeColumn}
          onColumnConfigUpdate={columnOps.updateColumnConfig}
          onColumnResize={columnOps.resizeColumn}
          onColumnsReorder={columnOps.reorderColumns}
          relatedData={relatedData}
        />
      </div>

      {/* Add column popover */}
      {showAddColumn && (
        <DataTableAddColumn
          onAdd={handleColumnAdded}
          onClose={() => setShowAddColumn(false)}
          tables={projectTables}
          currentTableId={tableId}
          currentColumns={table?.columns}
        />
      )}
    </div>
  );
}

import { useCallback } from "react";
import * as api from "@/lib/api";
import type { DataTable, DataTableColumn, DataTableColumnType } from "@openhelm/shared";

/**
 * Column-level CRUD handlers for the data table detail view.
 *
 * All handlers apply an optimistic update to local state where safe, then
 * persist via the IPC API. On failure they re-fetch the table from the server
 * so the UI never diverges from truth.
 */
export function useDataTableColumns(
  tableId: string,
  table: DataTable | null,
  setTable: (t: DataTable | null | ((prev: DataTable | null) => DataTable | null)) => void,
) {
  const reload = useCallback(() => {
    api.getDataTable(tableId).then(setTable).catch(console.error);
  }, [tableId, setTable]);

  const addColumn = useCallback(
    async (name: string, type: DataTableColumnType, config?: Record<string, unknown>) => {
      const column: DataTableColumn = {
        id: `col_${crypto.randomUUID().slice(0, 8)}`,
        name,
        type,
        config: config ?? {},
      };
      await api.addDataTableColumn({ tableId, column });
      reload();
    },
    [tableId, reload],
  );

  const removeColumn = useCallback(
    async (columnId: string) => {
      await api.removeDataTableColumn({ tableId, columnId });
      reload();
    },
    [tableId, reload],
  );

  const updateColumnConfig = useCallback(
    async (columnId: string, config: Record<string, unknown>) => {
      const updated = await api.updateDataTableColumnConfig({ tableId, columnId, config });
      setTable(updated);
    },
    [tableId, setTable],
  );

  const resizeColumn = useCallback(
    async (columnId: string, width: number) => {
      // Optimistic: apply the width locally so the drag feels instant.
      setTable((prev) =>
        prev
          ? { ...prev, columns: prev.columns.map((c) => (c.id === columnId ? { ...c, width } : c)) }
          : prev,
      );
      try {
        await api.updateDataTableColumn({ tableId, columnId, patch: { width } });
      } catch (err) {
        console.error("[DataTable] failed to persist width:", err);
        reload();
      }
    },
    [tableId, setTable, reload],
  );

  const reorderColumns = useCallback(
    async (nextColumnIds: string[]) => {
      if (!table) return;
      // Optimistic: reorder local state to match the new id order.
      const byId = new Map(table.columns.map((c) => [c.id, c]));
      const nextCols = nextColumnIds
        .map((id) => byId.get(id))
        .filter((c): c is NonNullable<typeof c> => c !== undefined);
      // Sanity: the new order must cover every existing column.
      if (nextCols.length !== table.columns.length) return;
      // No-op if order is unchanged.
      const unchanged = nextCols.every((c, i) => c.id === table.columns[i].id);
      if (unchanged) return;
      setTable({ ...table, columns: nextCols });
      try {
        const saved = await api.reorderDataTableColumns({
          tableId,
          columnIds: nextColumnIds,
        });
        setTable(saved);
      } catch (err) {
        console.error("[DataTable] failed to persist column order:", err);
        reload();
      }
    },
    [tableId, table, setTable, reload],
  );

  return { addColumn, removeColumn, updateColumnConfig, resizeColumn, reorderColumns };
}

import { create } from "zustand";
import * as api from "@/lib/api";
import type {
  DataTable,
  DataTableRow,
  DataTableColumn,
  CreateDataTableParams,
  UpdateDataTableParams,
} from "@openhelm/shared";

interface DataTableState {
  // Table list
  tables: DataTable[];
  tableCount: number;
  loading: boolean;
  error: string | null;

  // Current table detail
  currentRows: DataTableRow[];
  rowsLoading: boolean;

  // Actions — tables
  fetchTables: (projectId: string | null) => Promise<void>;
  fetchCount: (projectId: string | null) => Promise<void>;
  createTable: (params: CreateDataTableParams) => Promise<DataTable | null>;
  updateTable: (params: UpdateDataTableParams) => Promise<void>;
  deleteTable: (id: string) => Promise<void>;

  // Actions — rows
  fetchRows: (tableId: string) => Promise<void>;
  insertRows: (tableId: string, rows: Record<string, unknown>[]) => Promise<void>;
  updateRow: (rowId: string, data: Record<string, unknown>) => Promise<void>;
  deleteRows: (rowIds: string[]) => Promise<void>;

  // Actions — columns
  addColumn: (tableId: string, column: DataTableColumn) => Promise<void>;
  renameColumn: (tableId: string, columnId: string, newName: string) => Promise<void>;
  removeColumn: (tableId: string, columnId: string) => Promise<void>;
  updateColumnConfig: (tableId: string, columnId: string, config: Record<string, unknown>) => Promise<DataTable | null>;

  // Store update methods (from IPC events)
  addTableToStore: (table: DataTable) => void;
  updateTableInStore: (table: DataTable) => void;
  removeTableFromStore: (id: string) => void;
  refreshRowsForTable: (tableId: string) => void;
}

export const useDataTableStore = create<DataTableState>((set, get) => ({
  tables: [],
  tableCount: 0,
  loading: false,
  error: null,
  currentRows: [],
  rowsLoading: false,

  fetchTables: async (projectId: string | null) => {
    set({ loading: true, error: null });
    try {
      const tables = projectId
        ? await api.listDataTables({ projectId })
        : await api.listAllDataTables();
      set({ tables, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  fetchCount: async (projectId: string | null) => {
    try {
      const { count } = projectId
        ? await api.countDataTables(projectId)
        : await api.countAllDataTables();
      set({ tableCount: count });
    } catch { /* non-critical */ }
  },

  createTable: async (params) => {
    try {
      const table = await api.createDataTable(params);
      return table;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  updateTable: async (params) => {
    try {
      await api.updateDataTable(params);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  deleteTable: async (id) => {
    try {
      await api.deleteDataTable(id);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  fetchRows: async (tableId) => {
    set({ rowsLoading: true });
    try {
      const currentRows = await api.listDataTableRows({ tableId, limit: 200 });
      set({ currentRows, rowsLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), rowsLoading: false });
    }
  },

  insertRows: async (tableId, rows) => {
    try {
      await api.insertDataTableRows({ tableId, rows });
      await get().fetchRows(tableId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  updateRow: async (rowId, data) => {
    try {
      await api.updateDataTableRow({ id: rowId, data });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  deleteRows: async (rowIds) => {
    try {
      await api.deleteDataTableRows({ rowIds });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  addColumn: async (tableId, column) => {
    try {
      await api.addDataTableColumn({ tableId, column });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  renameColumn: async (tableId, columnId, newName) => {
    try {
      await api.renameDataTableColumn({ tableId, columnId, newName });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  removeColumn: async (tableId, columnId) => {
    try {
      await api.removeDataTableColumn({ tableId, columnId });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  updateColumnConfig: async (tableId, columnId, config) => {
    try {
      const table = await api.updateDataTableColumnConfig({ tableId, columnId, config });
      set((s) => ({ tables: s.tables.map((t) => (t.id === tableId ? table : t)) }));
      return table;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  addTableToStore: (table) => {
    set((s) => ({
      tables: [table, ...s.tables],
      tableCount: s.tableCount + 1,
    }));
  },

  updateTableInStore: (table) => {
    set((s) => ({
      tables: s.tables.map((t) => (t.id === table.id ? table : t)),
    }));
  },

  removeTableFromStore: (id) => {
    set((s) => ({
      tables: s.tables.filter((t) => t.id !== id),
      tableCount: Math.max(0, s.tableCount - 1),
    }));
  },

  refreshRowsForTable: (tableId) => {
    // Only refresh if we're currently viewing this table
    const rows = get().currentRows;
    if (rows.length > 0 && rows[0]?.tableId === tableId) {
      get().fetchRows(tableId);
    }
  },
}));

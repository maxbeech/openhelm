import { registerHandler } from "../handler.js";
import { emit } from "../emitter.js";
import * as dtQueries from "../../db/queries/data-tables.js";
import { scheduleVisualizationCheck } from "../../data-tables/visualization-suggester.js";
import type {
  CreateDataTableParams,
  UpdateDataTableParams,
  ListDataTablesParams,
  InsertDataTableRowsParams,
  UpdateDataTableRowParams,
  DeleteDataTableRowsParams,
  ListDataTableRowsParams,
  AddDataTableColumnParams,
  RenameDataTableColumnParams,
  RemoveDataTableColumnParams,
  UpdateDataTableColumnConfigParams,
  ListDataTableChangesParams,
} from "@openhelm/shared";

export function registerDataTableHandlers() {
  // ─── Table CRUD ───

  registerHandler("dataTables.list", (params) => {
    const p = params as ListDataTablesParams;
    return dtQueries.listDataTables(p ?? {});
  });

  registerHandler("dataTables.get", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const table = dtQueries.getDataTable(id);
    if (!table) throw new Error(`Data table not found: ${id}`);
    return table;
  });

  registerHandler("dataTables.create", async (params) => {
    const p = params as CreateDataTableParams;
    if (!p?.projectId) throw new Error("projectId is required");
    if (!p?.name) throw new Error("name is required");
    if (!p?.columns) throw new Error("columns is required");

    const table = dtQueries.createDataTable(p);

    // Generate embedding asynchronously (non-blocking)
    scheduleEmbeddingUpdate(table.id);

    emit("dataTable.created", table);
    return table;
  });

  registerHandler("dataTables.update", async (params) => {
    const p = params as UpdateDataTableParams;
    if (!p?.id) throw new Error("id is required");

    const table = dtQueries.updateDataTable(p);

    // Re-embed if name/description changed
    if (p.name !== undefined || p.description !== undefined) {
      scheduleEmbeddingUpdate(table.id);
    }

    emit("dataTable.updated", table);
    return table;
  });

  registerHandler("dataTables.delete", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const deleted = dtQueries.deleteDataTable(id);
    if (deleted) emit("dataTable.deleted", { id });
    return { deleted };
  });

  // ─── Row CRUD ───

  registerHandler("dataTables.listRows", (params) => {
    const p = params as ListDataTableRowsParams;
    if (!p?.tableId) throw new Error("tableId is required");
    return dtQueries.getDataTableRows(p);
  });

  registerHandler("dataTables.insertRows", (params) => {
    const p = params as InsertDataTableRowsParams;
    if (!p?.tableId) throw new Error("tableId is required");
    if (!p?.rows || !Array.isArray(p.rows)) throw new Error("rows array is required");

    const rows = dtQueries.insertDataTableRows(p);
    emit("dataTable.rowsChanged", { tableId: p.tableId });

    // Schedule visualization suggestion check (debounced)
    scheduleVisualizationCheck(p.tableId);

    // Update embedding if this is the first row (sample data now available)
    const table = dtQueries.getDataTable(p.tableId);
    if (table && table.rowCount <= p.rows.length) {
      scheduleEmbeddingUpdate(p.tableId);
    }

    return rows;
  });

  registerHandler("dataTables.updateRow", (params) => {
    const p = params as UpdateDataTableRowParams;
    if (!p?.id) throw new Error("id is required");
    if (!p?.data) throw new Error("data is required");

    const row = dtQueries.updateDataTableRow(p);
    emit("dataTable.rowsChanged", { tableId: row.tableId });
    return row;
  });

  registerHandler("dataTables.deleteRows", (params) => {
    const p = params as DeleteDataTableRowsParams;
    if (!p?.rowIds || !Array.isArray(p.rowIds)) throw new Error("rowIds array is required");

    // Get tableId from first row for event emission
    const firstRow = p.rowIds.length > 0 ? dtQueries.getDataTableRow(p.rowIds[0]) : null;
    const deleted = dtQueries.deleteDataTableRows(p);
    if (firstRow && deleted > 0) {
      emit("dataTable.rowsChanged", { tableId: firstRow.tableId });
    }
    return { deleted };
  });

  // ─── Schema operations ───

  registerHandler("dataTables.addColumn", (params) => {
    const p = params as AddDataTableColumnParams;
    if (!p?.tableId) throw new Error("tableId is required");
    if (!p?.column) throw new Error("column is required");

    const table = dtQueries.addColumn(p);
    scheduleEmbeddingUpdate(table.id);
    emit("dataTable.updated", table);
    return table;
  });

  registerHandler("dataTables.renameColumn", (params) => {
    const p = params as RenameDataTableColumnParams;
    if (!p?.tableId) throw new Error("tableId is required");
    if (!p?.columnId) throw new Error("columnId is required");
    if (!p?.newName) throw new Error("newName is required");

    const table = dtQueries.renameColumn(p);
    scheduleEmbeddingUpdate(table.id);
    emit("dataTable.updated", table);
    return table;
  });

  registerHandler("dataTables.removeColumn", (params) => {
    const p = params as RemoveDataTableColumnParams;
    if (!p?.tableId) throw new Error("tableId is required");
    if (!p?.columnId) throw new Error("columnId is required");

    const table = dtQueries.removeColumn(p);
    scheduleEmbeddingUpdate(table.id);
    emit("dataTable.updated", table);
    return table;
  });

  registerHandler("dataTables.updateColumnConfig", (params) => {
    const p = params as UpdateDataTableColumnConfigParams;
    if (!p?.tableId) throw new Error("tableId is required");
    if (!p?.columnId) throw new Error("columnId is required");
    if (!p?.config) throw new Error("config is required");

    const table = dtQueries.updateColumnConfig(p);
    scheduleEmbeddingUpdate(table.id);
    emit("dataTable.updated", table);
    return table;
  });

  // ─── Utility ───

  registerHandler("dataTables.count", (params) => {
    const { projectId } = params as { projectId?: string };
    if (!projectId) throw new Error("projectId is required");
    return { count: dtQueries.countDataTables(projectId) };
  });

  registerHandler("dataTables.listChanges", (params) => {
    const p = params as ListDataTableChangesParams;
    if (!p?.tableId) throw new Error("tableId is required");
    return dtQueries.listDataTableChanges(p);
  });

  // ─── Cross-project (All Projects mode) ───

  registerHandler("dataTables.listAll", () => {
    return dtQueries.listAllDataTables();
  });

  registerHandler("dataTables.countAll", () => {
    return { count: dtQueries.countAllDataTables() };
  });
}

// ─── Embedding helpers ───

const pendingEmbeddings = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Schedule an embedding update with 5-second debounce.
 * Batches rapid schema/data changes into a single embedding regeneration.
 */
function scheduleEmbeddingUpdate(tableId: string): void {
  const existing = pendingEmbeddings.get(tableId);
  if (existing) clearTimeout(existing);

  pendingEmbeddings.set(
    tableId,
    setTimeout(async () => {
      pendingEmbeddings.delete(tableId);
      try {
        const { generateTableEmbedding } = await import("../../data-tables/embeddings.js");
        await generateTableEmbedding(tableId);
      } catch (err) {
        console.error(`[dataTables] embedding update failed for ${tableId}:`, err);
      }
    }, 5_000),
  );
}

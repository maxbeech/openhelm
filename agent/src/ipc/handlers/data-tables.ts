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

    // Prevent deletion of system data tables
    const table = dtQueries.getDataTable(id);
    if (table?.isSystem) throw new Error("System data tables cannot be deleted");

    // Before deleting, clean up relation columns in other tables pointing to this one
    let modifiedTableIds: string[] = [];
    if (table) {
      modifiedTableIds = dtQueries.cleanupRelationColumnsForDeletedTable(id, table.projectId);
    }

    const deleted = dtQueries.deleteDataTable(id);
    if (deleted) {
      emit("dataTable.deleted", { id });
      for (const modId of modifiedTableIds) {
        const modTable = dtQueries.getDataTable(modId);
        if (modTable) emit("dataTable.updated", modTable);
      }
    }
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

    // Reciprocal sync for relation columns on newly inserted rows
    const table = dtQueries.getDataTable(p.tableId);
    if (table) {
      const affectedTargetTableIds = new Set<string>();
      for (const insertedRow of rows) {
        syncRelationColumnsForRow(table, insertedRow.id, {}, insertedRow.data, affectedTargetTableIds);
      }
      for (const targetId of affectedTargetTableIds) {
        emit("dataTable.rowsChanged", { tableId: targetId });
      }
    }

    // Schedule visualization suggestion check (debounced)
    scheduleVisualizationCheck(p.tableId);

    // Update embedding if this is the first row (sample data now available)
    if (table && table.rowCount <= p.rows.length) {
      scheduleEmbeddingUpdate(p.tableId);
    }

    return rows;
  });

  registerHandler("dataTables.updateRow", (params) => {
    const p = params as UpdateDataTableRowParams;
    if (!p?.id) throw new Error("id is required");
    if (!p?.data) throw new Error("data is required");

    // Get old data before update for relation diffing
    const oldRow = dtQueries.getDataTableRow(p.id);
    const oldData = oldRow?.data ?? {};

    const row = dtQueries.updateDataTableRow(p);
    emit("dataTable.rowsChanged", { tableId: row.tableId });

    // Reciprocal sync for relation columns (skip if this was a system update)
    if (p.actor !== "system") {
      const table = dtQueries.getDataTable(row.tableId);
      if (table) {
        const affectedTargetTableIds = new Set<string>();
        syncRelationColumnsForRow(table, row.id, oldData, row.data, affectedTargetTableIds);
        for (const targetId of affectedTargetTableIds) {
          emit("dataTable.rowsChanged", { tableId: targetId });
        }
      }
    }

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
      // Clean up relation references in other tables
      dtQueries.cleanupRelationReferences(p.rowIds, firstRow.tableId);
    }
    return { deleted };
  });

  // ─── Schema operations ───

  registerHandler("dataTables.addColumn", (params) => {
    const p = params as AddDataTableColumnParams;
    if (!p?.tableId) throw new Error("tableId is required");
    if (!p?.column) throw new Error("column is required");

    // Resolve rollup config: relationColumnId from name if needed
    if (p.column.type === "rollup") {
      const existing = dtQueries.getDataTable(p.tableId);
      if (existing) {
        const cfg = p.column.config as Record<string, unknown>;
        if (cfg.relationColumnName && !cfg.relationColumnId) {
          const relCol = existing.columns.find(
            (c) => c.type === "relation" && c.name.toLowerCase() === (cfg.relationColumnName as string).toLowerCase(),
          );
          if (relCol) {
            cfg.relationColumnId = relCol.id;
            const targetId = (relCol.config as { targetTableId?: string }).targetTableId;
            if (targetId && cfg.sourceColumnName && !cfg.sourceColumnId) {
              const targetTable = dtQueries.getDataTable(targetId);
              if (targetTable) {
                const srcCol = targetTable.columns.find(
                  (c) => c.name.toLowerCase() === (cfg.sourceColumnName as string).toLowerCase(),
                );
                if (srcCol) cfg.sourceColumnId = srcCol.id;
              }
            }
          }
        }
      }
    }

    const table = dtQueries.addColumn(p);
    scheduleEmbeddingUpdate(table.id);
    emit("dataTable.updated", table);

    // If this is a relation column with reciprocal enabled, create the paired column
    const config = p.column.config as { targetTableId?: string; reciprocal?: boolean };
    if (p.column.type === "relation" && config.targetTableId && config.reciprocal) {
      const sourceTable = dtQueries.getDataTable(p.tableId);
      const reciprocalColId = `col_${crypto.randomUUID().slice(0, 8)}`;
      const reciprocalColumn = {
        id: reciprocalColId,
        name: sourceTable?.name ?? "Related",
        type: "relation" as const,
        config: {
          targetTableId: p.tableId,
          reciprocalColumnId: p.column.id,
        },
      };

      // Add reciprocal column to target table
      const targetTable = dtQueries.addColumn({ tableId: config.targetTableId, column: reciprocalColumn, actor: "system" });

      // Update source column config with reciprocal column ID
      dtQueries.updateColumnConfig({
        tableId: p.tableId,
        columnId: p.column.id,
        config: { ...p.column.config, reciprocalColumnId: reciprocalColId },
        actor: "system",
      });

      scheduleEmbeddingUpdate(config.targetTableId);
      emit("dataTable.updated", targetTable);

      // Re-fetch and return the updated source table
      const updatedSource = dtQueries.getDataTable(p.tableId);
      if (updatedSource) {
        emit("dataTable.updated", updatedSource);
        return updatedSource;
      }
    }

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

// ─── Relation sync helpers ───

import type { DataTable } from "@openhelm/shared";

/**
 * Diff relation columns between old and new row data, then call
 * syncReciprocalRelation for each changed relation column.
 */
function syncRelationColumnsForRow(
  table: DataTable,
  rowId: string,
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
  affectedTargetTableIds: Set<string>,
): void {
  for (const col of table.columns) {
    if (col.type !== "relation") continue;
    const config = col.config as { targetTableId?: string; reciprocalColumnId?: string };
    if (!config.targetTableId || !config.reciprocalColumnId) continue;

    const oldIds = Array.isArray(oldData[col.id]) ? oldData[col.id] as string[] : [];
    const newIds = Array.isArray(newData[col.id]) ? newData[col.id] as string[] : [];

    const oldSet = new Set(oldIds);
    const newSet = new Set(newIds);
    const added = newIds.filter((id) => !oldSet.has(id));
    const removed = oldIds.filter((id) => !newSet.has(id));

    if (added.length === 0 && removed.length === 0) continue;

    dtQueries.syncReciprocalRelation({
      sourceTableId: table.id,
      sourceRowId: rowId,
      targetTableId: config.targetTableId,
      targetColumnId: config.reciprocalColumnId,
      addedRowIds: added,
      removedRowIds: removed,
    });

    affectedTargetTableIds.add(config.targetTableId);
  }
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

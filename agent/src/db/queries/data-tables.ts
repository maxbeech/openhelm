import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "../init.js";
import { dataTables, dataTableRows, dataTableChanges } from "../schema.js";
import type {
  DataTable,
  DataTableRow,
  DataTableChange,
  DataTableColumn,
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
  DataTableChangeAction,
  DataTableChangeActor,
} from "@openhelm/shared";

// ─── Row mappers ───

function rowToTable(row: typeof dataTables.$inferSelect): DataTable {
  return {
    ...row,
    description: row.description ?? null,
    columns: JSON.parse(row.columns || "[]") as DataTableColumn[],
    createdBy: row.createdBy as DataTable["createdBy"],
  };
}

function rowToTableRow(row: typeof dataTableRows.$inferSelect): DataTableRow {
  return {
    ...row,
    data: JSON.parse(row.data || "{}") as Record<string, unknown>,
  };
}

function rowToChange(row: typeof dataTableChanges.$inferSelect): DataTableChange {
  return {
    ...row,
    rowId: row.rowId ?? null,
    runId: row.runId ?? null,
    action: row.action as DataTableChangeAction,
    actor: row.actor as DataTableChangeActor,
    diff: JSON.parse(row.diff || "{}") as Record<string, unknown>,
  };
}

// ─── Change log helper ───

function logChange(params: {
  tableId: string;
  rowId?: string;
  action: DataTableChangeAction;
  actor?: DataTableChangeActor;
  runId?: string;
  diff?: Record<string, unknown>;
}): void {
  const db = getDb();
  db.insert(dataTableChanges)
    .values({
      id: crypto.randomUUID(),
      tableId: params.tableId,
      rowId: params.rowId ?? null,
      action: params.action,
      actor: params.actor ?? "user",
      runId: params.runId ?? null,
      diff: JSON.stringify(params.diff ?? {}),
      createdAt: new Date().toISOString(),
    })
    .run();
}

// ─── Table CRUD ───

export function createDataTable(params: CreateDataTableParams): DataTable {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const row = db
    .insert(dataTables)
    .values({
      id,
      projectId: params.projectId,
      name: params.name,
      description: params.description ?? null,
      columns: JSON.stringify(params.columns),
      isSystem: params.isSystem ?? false,
      createdBy: params.createdBy ?? "user",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return rowToTable(row);
}

export function getDataTable(id: string): DataTable | null {
  const db = getDb();
  const row = db.select().from(dataTables).where(eq(dataTables.id, id)).get();
  return row ? rowToTable(row) : null;
}

export function listDataTables(params: ListDataTablesParams): DataTable[] {
  const db = getDb();
  const conditions: ReturnType<typeof eq>[] = [];

  if (params.projectId) {
    conditions.push(eq(dataTables.projectId, params.projectId));
  }

  return db
    .select()
    .from(dataTables)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(dataTables.updatedAt))
    .all()
    .map(rowToTable);
}

export function updateDataTable(params: UpdateDataTableParams): DataTable {
  const db = getDb();
  const existing = getDataTable(params.id);
  if (!existing) throw new Error(`Data table not found: ${params.id}`);

  const row = db
    .update(dataTables)
    .set({
      ...(params.name !== undefined && { name: params.name }),
      ...(params.description !== undefined && { description: params.description }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(dataTables.id, params.id))
    .returning()
    .get();

  return rowToTable(row);
}

export function deleteDataTable(id: string): boolean {
  const db = getDb();
  // System data tables cannot be deleted (Autopilot Rules, Autopilot Metrics, etc.)
  const table = getDataTable(id);
  if (table?.isSystem) {
    throw new Error("Cannot delete a system data table");
  }
  const result = db.delete(dataTables).where(eq(dataTables.id, id)).run();
  return result.changes > 0;
}

// ─── Row CRUD ───

export function insertDataTableRows(params: InsertDataTableRowsParams): DataTableRow[] {
  const db = getDb();
  const now = new Date().toISOString();
  const inserted: DataTableRow[] = [];

  // Get current max sort order
  const maxRow = db
    .select({ maxSort: sql<number>`MAX(${dataTableRows.sortOrder})` })
    .from(dataTableRows)
    .where(eq(dataTableRows.tableId, params.tableId))
    .get();
  let nextSort = (maxRow?.maxSort ?? -1) + 1;

  for (const rowData of params.rows) {
    const id = crypto.randomUUID();
    const row = db
      .insert(dataTableRows)
      .values({
        id,
        tableId: params.tableId,
        data: JSON.stringify(rowData),
        sortOrder: nextSort++,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    const mapped = rowToTableRow(row);
    inserted.push(mapped);

    logChange({
      tableId: params.tableId,
      rowId: id,
      action: "insert",
      actor: params.actor,
      runId: params.runId,
      diff: { row: rowData },
    });
  }

  // Update denormalized row count
  updateRowCount(params.tableId);

  return inserted;
}

export function getDataTableRows(params: ListDataTableRowsParams): DataTableRow[] {
  const db = getDb();
  const limit = params.limit ?? 200;
  const offset = params.offset ?? 0;

  return db
    .select()
    .from(dataTableRows)
    .where(eq(dataTableRows.tableId, params.tableId))
    .orderBy(dataTableRows.sortOrder)
    .limit(limit)
    .offset(offset)
    .all()
    .map(rowToTableRow);
}

export function getDataTableRow(id: string): DataTableRow | null {
  const db = getDb();
  const row = db.select().from(dataTableRows).where(eq(dataTableRows.id, id)).get();
  return row ? rowToTableRow(row) : null;
}

export function updateDataTableRow(params: UpdateDataTableRowParams): DataTableRow {
  const db = getDb();
  const existing = getDataTableRow(params.id);
  if (!existing) throw new Error(`Data table row not found: ${params.id}`);

  // Merge new data with existing data
  const mergedData = { ...existing.data, ...params.data };

  const row = db
    .update(dataTableRows)
    .set({
      data: JSON.stringify(mergedData),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(dataTableRows.id, params.id))
    .returning()
    .get();

  logChange({
    tableId: existing.tableId,
    rowId: params.id,
    action: "update",
    actor: params.actor,
    runId: params.runId,
    diff: { old: existing.data, new: mergedData },
  });

  return rowToTableRow(row);
}

export function deleteDataTableRows(params: DeleteDataTableRowsParams): number {
  const db = getDb();
  let deleted = 0;
  let tableId: string | null = null;

  for (const rowId of params.rowIds) {
    const existing = getDataTableRow(rowId);
    if (!existing) continue;
    tableId = existing.tableId;

    const result = db.delete(dataTableRows).where(eq(dataTableRows.id, rowId)).run();
    if (result.changes > 0) {
      deleted++;
      logChange({
        tableId: existing.tableId,
        rowId,
        action: "delete",
        actor: params.actor,
        runId: params.runId,
        diff: { deletedRow: existing.data },
      });
    }
  }

  // Update denormalized row count
  if (tableId) updateRowCount(tableId);

  return deleted;
}

export function countDataTableRows(tableId: string): number {
  const db = getDb();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(dataTableRows)
    .where(eq(dataTableRows.tableId, tableId))
    .get();
  return row?.count ?? 0;
}

// ─── Schema operations ───

export function addColumn(params: AddDataTableColumnParams): DataTable {
  const db = getDb();
  const table = getDataTable(params.tableId);
  if (!table) throw new Error(`Data table not found: ${params.tableId}`);

  const columns = [...table.columns, params.column];

  const row = db
    .update(dataTables)
    .set({
      columns: JSON.stringify(columns),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(dataTables.id, params.tableId))
    .returning()
    .get();

  logChange({
    tableId: params.tableId,
    action: "schema_change",
    actor: params.actor,
    runId: params.runId,
    diff: { addedColumn: params.column },
  });

  return rowToTable(row);
}

export function renameColumn(params: RenameDataTableColumnParams): DataTable {
  const db = getDb();
  const table = getDataTable(params.tableId);
  if (!table) throw new Error(`Data table not found: ${params.tableId}`);

  const colIdx = table.columns.findIndex((c) => c.id === params.columnId);
  if (colIdx === -1) throw new Error(`Column not found: ${params.columnId}`);

  const oldName = table.columns[colIdx].name;
  const columns = [...table.columns];
  columns[colIdx] = { ...columns[colIdx], name: params.newName };

  const row = db
    .update(dataTables)
    .set({
      columns: JSON.stringify(columns),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(dataTables.id, params.tableId))
    .returning()
    .get();

  logChange({
    tableId: params.tableId,
    action: "schema_change",
    actor: params.actor,
    runId: params.runId,
    diff: { renamedColumn: params.columnId, oldName, newName: params.newName },
  });

  return rowToTable(row);
}

export function removeColumn(params: RemoveDataTableColumnParams): DataTable {
  const db = getDb();
  const table = getDataTable(params.tableId);
  if (!table) throw new Error(`Data table not found: ${params.tableId}`);

  const removed = table.columns.find((c) => c.id === params.columnId);
  if (!removed) throw new Error(`Column not found: ${params.columnId}`);

  const columns = table.columns.filter((c) => c.id !== params.columnId);

  const row = db
    .update(dataTables)
    .set({
      columns: JSON.stringify(columns),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(dataTables.id, params.tableId))
    .returning()
    .get();

  logChange({
    tableId: params.tableId,
    action: "schema_change",
    actor: params.actor,
    runId: params.runId,
    diff: { removedColumn: removed },
  });

  return rowToTable(row);
}

export function updateColumnConfig(params: UpdateDataTableColumnConfigParams): DataTable {
  const db = getDb();
  const table = getDataTable(params.tableId);
  if (!table) throw new Error(`Data table not found: ${params.tableId}`);

  const colIdx = table.columns.findIndex((c) => c.id === params.columnId);
  if (colIdx === -1) throw new Error(`Column not found: ${params.columnId}`);

  const columns = [...table.columns];
  columns[colIdx] = { ...columns[colIdx], config: params.config };

  const row = db
    .update(dataTables)
    .set({ columns: JSON.stringify(columns), updatedAt: new Date().toISOString() })
    .where(eq(dataTables.id, params.tableId))
    .returning()
    .get();

  logChange({
    tableId: params.tableId,
    action: "schema_change",
    actor: params.actor,
    runId: params.runId,
    diff: { updatedColumnConfig: { columnId: params.columnId, config: params.config } },
  });

  return rowToTable(row);
}

// ─── Embedding support ───

export interface DataTableWithEmbedding extends DataTable {
  embedding: number[] | null;
}

export function getTablesWithEmbeddings(projectId: string): DataTableWithEmbedding[] {
  const db = getDb();
  const rows = db
    .select()
    .from(dataTables)
    .where(eq(dataTables.projectId, projectId))
    .all();

  return rows.map((row) => ({
    ...rowToTable(row),
    embedding: row.embedding ? JSON.parse(row.embedding) : null,
  }));
}

export function updateTableEmbedding(tableId: string, embedding: number[]): void {
  const db = getDb();
  db.update(dataTables)
    .set({ embedding: JSON.stringify(embedding) })
    .where(eq(dataTables.id, tableId))
    .run();
}

// ─── Change log ───

export function listDataTableChanges(params: ListDataTableChangesParams): DataTableChange[] {
  const db = getDb();
  return db
    .select()
    .from(dataTableChanges)
    .where(eq(dataTableChanges.tableId, params.tableId))
    .orderBy(desc(dataTableChanges.createdAt))
    .limit(params.limit ?? 100)
    .offset(params.offset ?? 0)
    .all()
    .map(rowToChange);
}

// ─── Startup reconciliation ───

/**
 * Reconcile stale row_count values for all tables.
 * Called once at agent startup to fix any rows inserted outside of
 * insertDataTableRows() (e.g. direct SQL by Claude Code jobs).
 */
export function reconcileAllRowCounts(): void {
  const db = getDb();
  // Use Drizzle's sql tag — db.prepare() is not available on the Drizzle wrapper.
  db.run(sql`
    UPDATE data_tables
    SET row_count = (
      SELECT COUNT(*) FROM data_table_rows WHERE data_table_rows.table_id = data_tables.id
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE row_count != (
      SELECT COUNT(*) FROM data_table_rows WHERE data_table_rows.table_id = data_tables.id
    )
  `);
}

// ─── Helpers ───

function updateRowCount(tableId: string): void {
  const db = getDb();
  const count = countDataTableRows(tableId);
  db.update(dataTables)
    .set({ rowCount: count, updatedAt: new Date().toISOString() })
    .where(eq(dataTables.id, tableId))
    .run();
}

/** Get a few sample rows for embedding generation */
export function getSampleRows(tableId: string, limit = 5): DataTableRow[] {
  const db = getDb();
  return db
    .select()
    .from(dataTableRows)
    .where(eq(dataTableRows.tableId, tableId))
    .orderBy(dataTableRows.sortOrder)
    .limit(limit)
    .all()
    .map(rowToTableRow);
}

// ─── Relation helpers ───

/**
 * Sync reciprocal relation column when a relation cell is updated.
 * For each added target row, appends sourceRowId to its reciprocal column.
 * For each removed target row, removes sourceRowId from its reciprocal column.
 */
export function syncReciprocalRelation(params: {
  sourceTableId: string;
  sourceRowId: string;
  targetTableId: string;
  targetColumnId: string;
  addedRowIds: string[];
  removedRowIds: string[];
}): void {
  const db = getDb();

  for (const targetRowId of params.addedRowIds) {
    const row = db.select().from(dataTableRows).where(eq(dataTableRows.id, targetRowId)).get();
    if (!row) continue;
    const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
    const existing = Array.isArray(data[params.targetColumnId]) ? data[params.targetColumnId] as string[] : [];
    if (!existing.includes(params.sourceRowId)) {
      data[params.targetColumnId] = [...existing, params.sourceRowId];
      db.update(dataTableRows)
        .set({ data: JSON.stringify(data), updatedAt: new Date().toISOString() })
        .where(eq(dataTableRows.id, targetRowId))
        .run();
      logChange({
        tableId: params.targetTableId,
        rowId: targetRowId,
        action: "update",
        actor: "system",
        diff: { reciprocalAdd: { columnId: params.targetColumnId, addedId: params.sourceRowId } },
      });
    }
  }

  for (const targetRowId of params.removedRowIds) {
    const row = db.select().from(dataTableRows).where(eq(dataTableRows.id, targetRowId)).get();
    if (!row) continue;
    const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
    const existing = Array.isArray(data[params.targetColumnId]) ? data[params.targetColumnId] as string[] : [];
    const filtered = existing.filter((id) => id !== params.sourceRowId);
    if (filtered.length !== existing.length) {
      data[params.targetColumnId] = filtered;
      db.update(dataTableRows)
        .set({ data: JSON.stringify(data), updatedAt: new Date().toISOString() })
        .where(eq(dataTableRows.id, targetRowId))
        .run();
      logChange({
        tableId: params.targetTableId,
        rowId: targetRowId,
        action: "update",
        actor: "system",
        diff: { reciprocalRemove: { columnId: params.targetColumnId, removedId: params.sourceRowId } },
      });
    }
  }
}

/**
 * Clean up relation references when rows are deleted.
 * Scans all tables in the same project for relation columns pointing to
 * the source table, and removes the deleted row IDs from those cells.
 */
export function cleanupRelationReferences(deletedRowIds: string[], sourceTableId: string): void {
  const db = getDb();
  const sourceTable = getDataTable(sourceTableId);
  if (!sourceTable) return;

  // Find all tables in the same project
  const allTables = listDataTables({ projectId: sourceTable.projectId });

  for (const table of allTables) {
    const relationCols = table.columns.filter(
      (c) => c.type === "relation" && (c.config as { targetTableId?: string }).targetTableId === sourceTableId,
    );
    if (relationCols.length === 0) continue;

    const rows = db
      .select()
      .from(dataTableRows)
      .where(eq(dataTableRows.tableId, table.id))
      .all();

    for (const row of rows) {
      const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
      let changed = false;

      for (const col of relationCols) {
        const arr = Array.isArray(data[col.id]) ? data[col.id] as string[] : [];
        const filtered = arr.filter((id) => !deletedRowIds.includes(id));
        if (filtered.length !== arr.length) {
          data[col.id] = filtered;
          changed = true;
        }
      }

      if (changed) {
        db.update(dataTableRows)
          .set({ data: JSON.stringify(data), updatedAt: new Date().toISOString() })
          .where(eq(dataTableRows.id, row.id))
          .run();
      }
    }
  }
}

/**
 * Remove relation columns in other tables that point to a deleted table.
 * Returns the IDs of tables that were modified (for event emission).
 */
export function cleanupRelationColumnsForDeletedTable(deletedTableId: string, projectId: string): string[] {
  const db = getDb();
  const allTables = listDataTables({ projectId });
  const modifiedTableIds: string[] = [];

  for (const table of allTables) {
    if (table.id === deletedTableId) continue;
    const relationCols = table.columns.filter(
      (c) => c.type === "relation" && (c.config as { targetTableId?: string }).targetTableId === deletedTableId,
    );
    if (relationCols.length === 0) continue;

    const colIdsToRemove = new Set(relationCols.map((c) => c.id));
    const filteredColumns = table.columns.filter((c) => !colIdsToRemove.has(c.id));

    db.update(dataTables)
      .set({ columns: JSON.stringify(filteredColumns), updatedAt: new Date().toISOString() })
      .where(eq(dataTables.id, table.id))
      .run();

    for (const col of relationCols) {
      logChange({
        tableId: table.id,
        action: "schema_change",
        actor: "system",
        diff: { removedRelationColumn: col, reason: "target_table_deleted" },
      });
    }

    modifiedTableIds.push(table.id);
  }

  return modifiedTableIds;
}

// ─── Cross-project queries (All Projects mode) ───

export function listAllDataTables(): DataTable[] {
  const db = getDb();
  return db
    .select()
    .from(dataTables)
    .orderBy(desc(dataTables.updatedAt))
    .all()
    .map(rowToTable);
}

export function countDataTables(projectId: string): number {
  const db = getDb();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(dataTables)
    .where(eq(dataTables.projectId, projectId))
    .get();
  return row?.count ?? 0;
}

export function countAllDataTables(): number {
  const db = getDb();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(dataTables)
    .get();
  return row?.count ?? 0;
}

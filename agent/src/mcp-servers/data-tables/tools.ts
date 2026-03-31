/**
 * MCP tool definitions and handlers for data table CRUD.
 * Each tool maps to query functions in db/queries/data-tables.ts.
 */

import {
  createDataTable,
  getDataTable,
  getDataTableRow,
  listDataTables,
  insertDataTableRows,
  getDataTableRows,
  updateDataTableRow,
  deleteDataTableRows,
  countDataTableRows,
  addColumn,
  renameColumn,
  removeColumn,
  getSampleRows,
} from "../../db/queries/data-tables.js";
import { validateRowData } from "./validation.js";
import { TARGET_TOOL_DEFINITIONS, handleTargetToolCall } from "./target-tools.js";
import { VISUALIZATION_TOOL_DEFINITIONS, handleVisualizationToolCall } from "./visualization-tools.js";
import type { DataTableColumn, DataTableRow, RollupAggregation } from "@openhelm/shared";
import { evaluateFormula } from "@openhelm/shared";
import { computeRollup } from "@openhelm/shared";

// ─── Tool definitions (MCP protocol format) ───

export const TOOL_DEFINITIONS = [
  {
    name: "list_tables",
    description: "List all data tables in the project with their schemas and row counts.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "query_table",
    description: "Get rows from a data table. Supports pagination with limit/offset.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tableId: { type: "string", description: "Table ID" },
        tableName: { type: "string", description: "Table name (alternative to tableId)" },
        limit: { type: "number", description: "Max rows to return (default 50, max 200)" },
        offset: { type: "number", description: "Skip first N rows (default 0)" },
      },
    },
  },
  {
    name: "get_table_summary",
    description: "Get a table's schema, row count, and a few sample rows. Use this before modifying a table to understand its structure.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tableId: { type: "string", description: "Table ID" },
        tableName: { type: "string", description: "Table name (alternative to tableId)" },
      },
    },
  },
  {
    name: "create_table",
    description: "Create a new data table with a defined column schema.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Table name" },
        description: { type: "string", description: "Optional description" },
        columns: {
          type: "array",
          description: "Column definitions",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string", enum: ["text", "number", "date", "checkbox", "select", "multi_select", "url", "email", "relation", "phone", "files", "rollup", "formula", "created_time", "updated_time"] },
              config: { type: "object", description: "Type-specific config. For select: { options: [{ label }] }. For relation: { targetTableName: string }. For rollup: { relationColumnName: string, sourceColumnName: string, aggregation: 'count'|'sum'|'average'|'min'|'max'|'count_values'|'count_unique'|'percent_empty'|'percent_not_empty'|'show_original' }. For formula: { expression: string }." },
            },
            required: ["name", "type"],
          },
        },
      },
      required: ["name", "columns"],
    },
  },
  {
    name: "insert_rows",
    description: "Insert one or more rows into a data table. Keys should be column names.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tableId: { type: "string", description: "Table ID" },
        tableName: { type: "string", description: "Table name (alternative to tableId)" },
        rows: {
          type: "array",
          description: "Row data objects keyed by column name",
          items: { type: "object" },
        },
      },
      required: ["rows"],
    },
  },
  {
    name: "update_rows",
    description: "Update specific rows by their row IDs. Provide a mapping of rowId to new data.",
    inputSchema: {
      type: "object" as const,
      properties: {
        updates: {
          type: "array",
          description: "Array of { rowId, data } objects",
          items: {
            type: "object",
            properties: {
              rowId: { type: "string" },
              data: { type: "object", description: "Column name → new value" },
            },
            required: ["rowId", "data"],
          },
        },
      },
      required: ["updates"],
    },
  },
  {
    name: "delete_rows",
    description: "Delete rows by their row IDs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        rowIds: {
          type: "array",
          items: { type: "string" },
          description: "Row IDs to delete",
        },
      },
      required: ["rowIds"],
    },
  },
  {
    name: "add_column",
    description: "Add a new column to an existing table.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tableId: { type: "string", description: "Table ID" },
        tableName: { type: "string", description: "Table name (alternative to tableId)" },
        name: { type: "string", description: "Column name" },
        type: { type: "string", enum: ["text", "number", "date", "checkbox", "select", "multi_select", "url", "email", "relation", "phone", "files", "rollup", "formula", "created_time", "updated_time"] },
        config: { type: "object", description: "Type-specific config. For relation: { targetTableName: string }. For rollup: { relationColumnName, sourceColumnName, aggregation }. For formula: { expression }." },
      },
      required: ["name", "type"],
    },
  },
  {
    name: "rename_column",
    description: "Rename a column in a table.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tableId: { type: "string", description: "Table ID" },
        tableName: { type: "string", description: "Table name (alternative to tableId)" },
        columnName: { type: "string", description: "Current column name" },
        newName: { type: "string", description: "New column name" },
      },
      required: ["columnName", "newName"],
    },
  },
  {
    name: "remove_column",
    description: "Remove a column from a table. Existing row data for this column is preserved but hidden.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tableId: { type: "string", description: "Table ID" },
        tableName: { type: "string", description: "Table name (alternative to tableId)" },
        columnName: { type: "string", description: "Column name to remove" },
      },
      required: ["columnName"],
    },
  },
  ...TARGET_TOOL_DEFINITIONS,
  ...VISUALIZATION_TOOL_DEFINITIONS,
];

// ─── Tool handler ───

export function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  projectId?: string,
  runId?: string,
): unknown {
  switch (toolName) {
    case "list_tables":
      return handleListTables(projectId);
    case "query_table":
      return handleQueryTable(args, projectId);
    case "get_table_summary":
      return handleGetTableSummary(args, projectId);
    case "create_table":
      return handleCreateTable(args, projectId);
    case "insert_rows":
      return handleInsertRows(args, projectId, runId);
    case "update_rows":
      return handleUpdateRows(args, runId);
    case "delete_rows":
      return handleDeleteRows(args, runId);
    case "add_column":
      return handleAddColumn(args, projectId, runId);
    case "rename_column":
      return handleRenameColumn(args, projectId, runId);
    case "remove_column":
      return handleRemoveColumn(args, projectId, runId);
    case "list_targets":
    case "create_target":
    case "update_target":
    case "delete_target":
    case "evaluate_targets":
      return handleTargetToolCall(toolName, args, projectId);
    case "list_visualizations":
    case "create_visualization":
    case "update_visualization":
    case "delete_visualization":
      return handleVisualizationToolCall(toolName, args, projectId);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ─── Helpers ───

function resolveTable(args: Record<string, unknown>, projectId?: string) {
  if (args.tableId) return getDataTable(args.tableId as string);
  if (args.tableName && projectId) {
    const tables = listDataTables({ projectId });
    return tables.find((t) => t.name.toLowerCase() === (args.tableName as string).toLowerCase()) ?? null;
  }
  return null;
}

function requireTable(args: Record<string, unknown>, projectId?: string) {
  const table = resolveTable(args, projectId);
  if (!table) throw new Error(`Table not found: ${args.tableId || args.tableName}`);
  return table;
}

/** Convert column-name-keyed data to column-ID-keyed data */
function nameToIdData(columns: DataTableColumn[], data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const col = columns.find((c) => c.name.toLowerCase() === key.toLowerCase() || c.id === key);
    if (col) result[col.id] = value;
  }
  return result;
}

/** Convert column-ID-keyed row data to column-name-keyed for display */
function idToNameData(columns: DataTableColumn[], row: DataTableRow): Record<string, unknown> {
  const result: Record<string, unknown> = { _rowId: row.id };
  for (const col of columns) {
    const val = row.data[col.id] ?? null;

    // Relation: resolve row IDs to display titles
    if (col.type === "relation" && Array.isArray(val) && val.length > 0) {
      const config = col.config as { targetTableId?: string };
      if (config.targetTableId) {
        const targetTable = getDataTable(config.targetTableId);
        if (targetTable) {
          result[col.name] = val.map((rowId: string) => {
            const targetRow = getDataTableRow(rowId);
            return targetRow ? getRowTitle(targetTable, targetRow) : `[deleted:${rowId.slice(0, 8)}]`;
          });
          continue;
        }
      }
    }

    // Rollup: compute from related data
    if (col.type === "rollup") {
      result[col.name] = computeRollupForRow(columns, row, col);
      continue;
    }

    // Formula: evaluate expression
    if (col.type === "formula") {
      const config = col.config as { expression?: string };
      if (config.expression) {
        const colNameToId: Record<string, string> = {};
        for (const c of columns) { colNameToId[c.name.toLowerCase()] = c.id; }
        result[col.name] = evaluateFormula(config.expression, row.data, colNameToId);
      } else {
        result[col.name] = null;
      }
      continue;
    }

    // System timestamps
    if (col.type === "created_time") { result[col.name] = row.createdAt; continue; }
    if (col.type === "updated_time") { result[col.name] = row.updatedAt; continue; }

    result[col.name] = val;
  }
  return result;
}

/** Compute a rollup value for a specific row */
function computeRollupForRow(columns: DataTableColumn[], row: DataTableRow, rollupCol: DataTableColumn): unknown {
  const config = rollupCol.config as { relationColumnId?: string; sourceColumnId?: string; aggregation?: RollupAggregation };
  if (!config.relationColumnId || !config.sourceColumnId) return null;
  const aggregation = config.aggregation ?? "count";

  // Find the relation column
  const relCol = columns.find((c) => c.id === config.relationColumnId);
  if (!relCol || relCol.type !== "relation") return null;

  const relConfig = relCol.config as { targetTableId?: string };
  if (!relConfig.targetTableId) return null;

  // Get related row IDs
  const relatedIds = Array.isArray(row.data[relCol.id]) ? row.data[relCol.id] as string[] : [];
  if (relatedIds.length === 0) return aggregation === "count" ? 0 : null;

  // Fetch values from related rows
  const values: unknown[] = [];
  for (const rid of relatedIds) {
    const targetRow = getDataTableRow(rid);
    if (targetRow) values.push(targetRow.data[config.sourceColumnId] ?? null);
  }

  return computeRollup(aggregation, values);
}

/** Resolve name-based references in column config to IDs */
function resolveColumnConfig(
  colType: string,
  config: Record<string, unknown>,
  projectId?: string,
  existingColumns?: DataTableColumn[],
): Record<string, unknown> {
  if (colType === "relation") {
    if (config.targetTableId) return config;
    if (config.targetTableName && projectId) {
      const tables = listDataTables({ projectId });
      const target = tables.find((t) => t.name.toLowerCase() === (config.targetTableName as string).toLowerCase());
      if (!target) throw new Error(`Target table "${config.targetTableName}" not found in this project`);
      return { ...config, targetTableId: target.id };
    }
    throw new Error("Relation columns require targetTableId or targetTableName in config");
  }

  if (colType === "rollup" && existingColumns) {
    const resolved = { ...config };
    // Resolve relationColumnName → relationColumnId
    if (config.relationColumnName && !config.relationColumnId) {
      const relCol = existingColumns.find(
        (c) => c.type === "relation" && c.name.toLowerCase() === (config.relationColumnName as string).toLowerCase(),
      );
      if (!relCol) throw new Error(`Relation column "${config.relationColumnName}" not found in this table`);
      resolved.relationColumnId = relCol.id;
      // Also resolve the target table's column
      const targetTableId = (relCol.config as { targetTableId?: string }).targetTableId;
      if (targetTableId && config.sourceColumnName && !config.sourceColumnId) {
        const targetTable = getDataTable(targetTableId);
        if (!targetTable) throw new Error(`Target table "${targetTableId}" not found for rollup source column resolution`);
        const srcCol = targetTable.columns.find(
          (c) => c.name.toLowerCase() === (config.sourceColumnName as string).toLowerCase(),
        );
        if (!srcCol) throw new Error(`Source column "${config.sourceColumnName}" not found in target table "${targetTable.name}"`);
        resolved.sourceColumnId = srcCol.id;
      }
    }
    if (!resolved.aggregation) resolved.aggregation = "count";
    return resolved;
  }

  return config;
}

/** Get display title for a row (first text column value, or row ID) */
function getRowTitle(table: { columns: DataTableColumn[] }, row: DataTableRow): string {
  const textCol = table.columns.find((c) => c.type === "text");
  if (textCol && row.data[textCol.id]) return String(row.data[textCol.id]);
  return row.id.slice(0, 8);
}

// ─── Handlers ───

function handleListTables(projectId?: string) {
  const tables = projectId ? listDataTables({ projectId }) : listDataTables({});
  return tables.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    rowCount: t.rowCount,
    columns: t.columns.map((c) => ({ name: c.name, type: c.type })),
  }));
}

function handleQueryTable(args: Record<string, unknown>, projectId?: string) {
  const table = requireTable(args, projectId);
  const limit = Math.min(Number(args.limit) || 50, 200);
  const offset = Number(args.offset) || 0;
  const rows = getDataTableRows({ tableId: table.id, limit, offset });
  const total = countDataTableRows(table.id);

  return {
    table: table.name,
    totalRows: total,
    offset,
    limit,
    rows: rows.map((r) => idToNameData(table.columns, r)),
  };
}

function handleGetTableSummary(args: Record<string, unknown>, projectId?: string) {
  const table = requireTable(args, projectId);
  const samples = getSampleRows(table.id, 5);

  return {
    id: table.id,
    name: table.name,
    description: table.description,
    rowCount: table.rowCount,
    columns: table.columns.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      config: c.config,
    })),
    sampleRows: samples.map((r) => idToNameData(table.columns, r)),
  };
}

function handleCreateTable(args: Record<string, unknown>, projectId?: string) {
  if (!projectId) throw new Error("projectId is required to create a table");
  const name = args.name as string;
  const description = args.description as string | undefined;
  const rawColumns = args.columns as Array<{ name: string; type: string; config?: Record<string, unknown> }>;

  // Check for duplicate name
  const existing = listDataTables({ projectId });
  if (existing.find((t) => t.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`A table named "${name}" already exists in this project`);
  }

  const columns: DataTableColumn[] = rawColumns.map((c) => ({
    id: `col_${crypto.randomUUID().slice(0, 8)}`,
    name: c.name,
    type: c.type as DataTableColumn["type"],
    config: resolveColumnConfig(c.type, c.config ?? {}, projectId),
  }));

  const table = createDataTable({ projectId, name, description, columns, createdBy: "ai" });
  return { id: table.id, name: table.name, columns: table.columns.map((c) => ({ name: c.name, type: c.type })) };
}

function handleInsertRows(args: Record<string, unknown>, projectId?: string, runId?: string) {
  const table = requireTable(args, projectId);
  const rawRows = args.rows as Record<string, unknown>[];
  if (!rawRows || rawRows.length === 0) throw new Error("rows array is required");
  if (rawRows.length > 100) throw new Error("Maximum 100 rows per insert (rate limit)");

  const rows = rawRows.map((r) => {
    const mapped = nameToIdData(table.columns, r);
    validateRowData(table.columns, mapped);
    return mapped;
  });

  const inserted = insertDataTableRows({ tableId: table.id, rows, actor: "ai", runId });
  return { inserted: inserted.length, tableId: table.id, tableName: table.name };
}

function handleUpdateRows(args: Record<string, unknown>, runId?: string) {
  const updates = args.updates as Array<{ rowId: string; data: Record<string, unknown> }>;
  if (!updates || updates.length === 0) throw new Error("updates array is required");
  if (updates.length > 100) throw new Error("Maximum 100 updates per call (rate limit)");

  let updated = 0;
  for (const u of updates) {
    // Get the row's table to resolve column names
    const row = getDataTableRow(u.rowId);
    if (!row) continue;
    const table = getDataTable(row.tableId);
    if (!table) continue;

    const mapped = nameToIdData(table.columns, u.data);
    validateRowData(table.columns, mapped);
    updateDataTableRow({ id: u.rowId, data: mapped, actor: "ai", runId });
    updated++;
  }

  return { updated };
}

function handleDeleteRows(args: Record<string, unknown>, runId?: string) {
  const rowIds = args.rowIds as string[];
  if (!rowIds || rowIds.length === 0) throw new Error("rowIds array is required");
  if (rowIds.length > 100) throw new Error("Maximum 100 deletes per call (rate limit)");

  const deleted = deleteDataTableRows({ rowIds, actor: "ai", runId });
  return { deleted };
}

function handleAddColumn(args: Record<string, unknown>, projectId?: string, runId?: string) {
  const table = requireTable(args, projectId);
  const colType = args.type as string;
  const rawConfig = (args.config as Record<string, unknown>) ?? {};
  const column: DataTableColumn = {
    id: `col_${crypto.randomUUID().slice(0, 8)}`,
    name: args.name as string,
    type: colType as DataTableColumn["type"],
    config: resolveColumnConfig(colType, rawConfig, projectId, table.columns),
  };

  const updated = addColumn({ tableId: table.id, column, actor: "ai", runId });
  return { tableId: updated.id, columns: updated.columns.map((c) => ({ name: c.name, type: c.type })) };
}

function handleRenameColumn(args: Record<string, unknown>, projectId?: string, runId?: string) {
  const table = requireTable(args, projectId);
  const col = table.columns.find((c) => c.name.toLowerCase() === (args.columnName as string).toLowerCase());
  if (!col) throw new Error(`Column "${args.columnName}" not found`);

  const updated = renameColumn({ tableId: table.id, columnId: col.id, newName: args.newName as string, actor: "ai", runId });
  return { tableId: updated.id, columns: updated.columns.map((c) => ({ name: c.name, type: c.type })) };
}

function handleRemoveColumn(args: Record<string, unknown>, projectId?: string, runId?: string) {
  const table = requireTable(args, projectId);
  const col = table.columns.find((c) => c.name.toLowerCase() === (args.columnName as string).toLowerCase());
  if (!col) throw new Error(`Column "${args.columnName}" not found`);

  const updated = removeColumn({ tableId: table.id, columnId: col.id, actor: "ai", runId });
  return { tableId: updated.id, columns: updated.columns.map((c) => ({ name: c.name, type: c.type })) };
}

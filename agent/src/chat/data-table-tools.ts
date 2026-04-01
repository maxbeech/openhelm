/**
 * Data table tool definitions and execution for the AI chat sidebar.
 * Separated from tools.ts / tool-executor.ts to keep files within size limits.
 */

import type { ToolDefinition } from "./tools.js";
import {
  listDataTables, listAllDataTables, getDataTable, getDataTableRows,
  createDataTable, insertDataTableRows, updateDataTableRow, deleteDataTableRows, deleteDataTable,
} from "../db/queries/data-tables.js";
import { emit } from "../ipc/emitter.js";
import type { ChatToolCall } from "@openhelm/shared";
/** Matches ToolExecutionResult in tool-executor.ts (duplicated to avoid circular import). */
interface ToolExecResult {
  callId: string;
  tool: string;
  result: unknown;
  error?: string;
}

export const DATA_TABLE_TOOLS: ToolDefinition[] = [
  // ─── Read tools ───
  {
    name: "list_data_tables",
    description: "List all data tables in the active project, with their schemas and row counts.",
    isWrite: false,
    parameters: {},
  },
  {
    name: "get_data_table",
    description: "Get a data table's full schema (columns, types, row count).",
    isWrite: false,
    parameters: {
      tableId: { type: "string", description: "Data table ID", required: true },
    },
  },
  {
    name: "get_data_table_rows",
    description: "Get rows from a data table (paginated, max 200 per call).",
    isWrite: false,
    parameters: {
      tableId: { type: "string", description: "Data table ID", required: true },
      limit: { type: "number", description: "Max rows to return (default 200)" },
      offset: { type: "number", description: "Offset for pagination (default 0)" },
    },
  },
  // ─── Write tools (require confirmation) ───
  {
    name: "create_data_table",
    description: "Create a new data table with defined column schema. Column types: text, number, boolean, date, select, multi_select, url, email, relation.",
    isWrite: true,
    parameters: {
      name: { type: "string", description: "Table name", required: true },
      description: { type: "string", description: "Table description" },
      columns: { type: "array", description: "JSON array of column definitions: [{id, name, type, config?}]", required: true },
    },
  },
  {
    name: "insert_data_table_rows",
    description: "Insert rows into a data table (max 100 per call). Each row is an object keyed by column ID.",
    isWrite: true,
    parameters: {
      tableId: { type: "string", description: "Data table ID", required: true },
      rows: { type: "array", description: "Array of row data objects", required: true },
    },
  },
  {
    name: "update_data_table_row",
    description: "Update a single row in a data table by merging new data.",
    isWrite: true,
    parameters: {
      rowId: { type: "string", description: "Row ID", required: true },
      data: { type: "object", description: "Partial row data to merge", required: true },
    },
  },
  {
    name: "delete_data_table_rows",
    description: "Delete rows from a data table by ID.",
    isWrite: true,
    parameters: {
      rowIds: { type: "array", description: "Array of row IDs to delete", required: true },
    },
  },
  {
    name: "delete_data_table",
    description: "Delete a data table and all its rows.",
    isWrite: true,
    parameters: {
      tableId: { type: "string", description: "Data table ID", required: true },
    },
  },
];

/** Human-readable one-line summary of a data table write tool call. */
export function describeDataTableAction(tool: string, args: Record<string, unknown>): string | null {
  switch (tool) {
    case "create_data_table": return `Create data table: "${args.name}"`;
    case "insert_data_table_rows": return `Insert ${Array.isArray(args.rows) ? args.rows.length : "?"} row(s) into table ${args.tableId}`;
    case "update_data_table_row": return `Update row ${args.rowId}`;
    case "delete_data_table_rows": return `Delete ${Array.isArray(args.rowIds) ? args.rowIds.length : "?"} row(s)`;
    case "delete_data_table": return `Delete data table ${args.tableId}`;
    default: return null;
  }
}

// ─── Execution helpers (shared by tool-executor.ts) ───

function ok(call: ChatToolCall, result: unknown): ToolExecResult {
  return { callId: call.id, tool: call.tool, result };
}

function fail(call: ChatToolCall, error: string): ToolExecResult {
  console.error(`[chat:tool] ${call.tool} failed: ${error}`);
  return { callId: call.id, tool: call.tool, result: null, error };
}

/** Execute a data table read tool. Returns null if the tool is not a data table tool. */
export function executeDataTableReadTool(
  call: ChatToolCall, projectId: string | undefined,
): ToolExecResult | null {
  const a = call.args;
  switch (call.tool) {
    case "list_data_tables":
      return ok(call, projectId ? listDataTables({ projectId }) : listAllDataTables());
    case "get_data_table": {
      if (!a.tableId) return fail(call, "tableId is required");
      const table = getDataTable(a.tableId as string);
      return table ? ok(call, table) : fail(call, `Data table not found: ${a.tableId}`);
    }
    case "get_data_table_rows": {
      if (!a.tableId) return fail(call, "tableId is required");
      return ok(call, getDataTableRows({
        tableId: a.tableId as string,
        limit: (a.limit as number | undefined) ?? 200,
        offset: (a.offset as number | undefined) ?? 0,
      }));
    }
    default:
      return null;
  }
}

/** Execute a data table write tool. Returns null if the tool is not a data table tool. */
export function executeDataTableWriteTool(
  call: ChatToolCall, projectId: string | null,
): ToolExecResult | null {
  const a = call.args;
  switch (call.tool) {
    case "create_data_table": {
      if (!a.name) return fail(call, "name is required");
      if (!a.columns) return fail(call, "columns is required");
      if (!projectId) return fail(call, "Cannot create data table in All Projects thread");
      const columns = Array.isArray(a.columns) ? a.columns : JSON.parse(a.columns as string);
      const table = createDataTable({
        projectId,
        name: a.name as string,
        description: a.description as string | undefined,
        columns,
        createdBy: "ai",
      });
      emit("dataTable.created", table);
      return ok(call, table);
    }
    case "insert_data_table_rows": {
      if (!a.tableId) return fail(call, "tableId is required");
      if (!a.rows) return fail(call, "rows is required");
      const rows = Array.isArray(a.rows) ? a.rows : JSON.parse(a.rows as string);
      const inserted = insertDataTableRows({ tableId: a.tableId as string, rows, actor: "ai" });
      emit("dataTable.rowsInserted", { tableId: a.tableId, count: inserted.length });
      return ok(call, { inserted: inserted.length, rows: inserted });
    }
    case "update_data_table_row": {
      if (!a.rowId) return fail(call, "rowId is required");
      if (!a.data) return fail(call, "data is required");
      const data = typeof a.data === "string" ? JSON.parse(a.data) : a.data;
      const updated = updateDataTableRow({
        id: a.rowId as string,
        data: data as Record<string, unknown>,
        actor: "ai",
      });
      emit("dataTable.rowUpdated", { rowId: a.rowId });
      return ok(call, updated);
    }
    case "delete_data_table_rows": {
      if (!a.rowIds) return fail(call, "rowIds is required");
      const rowIds = Array.isArray(a.rowIds) ? a.rowIds : JSON.parse(a.rowIds as string);
      const deleted = deleteDataTableRows({ rowIds: rowIds as string[], actor: "ai" });
      emit("dataTable.rowsDeleted", { count: deleted });
      return ok(call, { deleted });
    }
    case "delete_data_table": {
      if (!a.tableId) return fail(call, "tableId is required");
      const deleted = deleteDataTable(a.tableId as string);
      if (deleted) emit("dataTable.deleted", { id: a.tableId });
      return ok(call, { deleted });
    }
    default:
      return null;
  }
}

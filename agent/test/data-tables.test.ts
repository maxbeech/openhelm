import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../src/db/init.js";
import {
  createDataTable,
  getDataTable,
  listDataTables,
  updateDataTable,
  deleteDataTable,
  insertDataTableRows,
  getDataTableRows,
  getDataTableRow,
  updateDataTableRow,
  deleteDataTableRows,
  countDataTableRows,
  addColumn,
  renameColumn,
  removeColumn,
  updateColumn,
  reorderColumns,
  listDataTableChanges,
  getTablesWithEmbeddings,
  updateTableEmbedding,
  getSampleRows,
  listAllDataTables,
  countDataTables,
  countAllDataTables,
} from "../src/db/queries/data-tables.js";
import { createProject } from "../src/db/queries/projects.js";
import { createJob } from "../src/db/queries/jobs.js";
import { createRun } from "../src/db/queries/runs.js";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";
import type { DataTableColumn } from "@openhelm/shared";

function setupTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "oo-dt-test-"));
  initDatabase(join(dir, "test.db"));
}

function createTestProject() {
  return createProject({ name: "Test Project", directoryPath: "/tmp/test" });
}

const TEST_COLUMNS: DataTableColumn[] = [
  { id: "col_name", name: "Name", type: "text", config: {} },
  {
    id: "col_status",
    name: "Status",
    type: "select",
    config: {
      options: [
        { id: "opt_lead", label: "Lead", color: "blue" },
        { id: "opt_qual", label: "Qualified", color: "green" },
      ],
    },
  },
  { id: "col_revenue", name: "Revenue", type: "number", config: { format: "currency" } },
];

describe("Data Table CRUD", () => {
  beforeEach(() => setupTestDb());

  it("creates and retrieves a table", () => {
    const project = createTestProject();
    const table = createDataTable({
      projectId: project.id,
      name: "Customers",
      description: "Prospective leads",
      columns: TEST_COLUMNS,
    });

    expect(table.id).toBeTruthy();
    expect(table.name).toBe("Customers");
    expect(table.description).toBe("Prospective leads");
    // 3 user columns + 2 auto-injected timestamp columns.
    expect(table.columns).toHaveLength(5);
    expect(table.columns[0].id).toBe("col_name");
    expect(table.columns.find((c) => c.type === "created_time")).toBeDefined();
    expect(table.columns.find((c) => c.type === "updated_time")).toBeDefined();
    expect(table.rowCount).toBe(0);
    expect(table.createdBy).toBe("user");

    const fetched = getDataTable(table.id);
    expect(fetched).toEqual(table);
  });

  it("lists tables filtered by project", () => {
    const proj1 = createTestProject();
    const proj2 = createProject({ name: "P2", directoryPath: "/tmp/p2" });
    createDataTable({ projectId: proj1.id, name: "T1", columns: [] });
    createDataTable({ projectId: proj1.id, name: "T2", columns: [] });
    createDataTable({ projectId: proj2.id, name: "T3", columns: [] });

    expect(listDataTables({ projectId: proj1.id })).toHaveLength(2);
    expect(listDataTables({ projectId: proj2.id })).toHaveLength(1);
    expect(listAllDataTables()).toHaveLength(3);
  });

  it("updates table name and description", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "Old", columns: [] });

    const updated = updateDataTable({ id: table.id, name: "New", description: "Updated desc" });
    expect(updated.name).toBe("New");
    expect(updated.description).toBe("Updated desc");
  });

  it("deletes a table", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "Delete me", columns: [] });

    expect(deleteDataTable(table.id)).toBe(true);
    expect(getDataTable(table.id)).toBeNull();
  });

  it("counts tables", () => {
    const proj1 = createTestProject();
    const proj2 = createProject({ name: "P2", directoryPath: "/tmp/p2" });
    createDataTable({ projectId: proj1.id, name: "T1", columns: [] });
    createDataTable({ projectId: proj1.id, name: "T2", columns: [] });
    createDataTable({ projectId: proj2.id, name: "T3", columns: [] });

    expect(countDataTables(proj1.id)).toBe(2);
    expect(countAllDataTables()).toBe(3);
  });

  it("creates table with AI creator", () => {
    const project = createTestProject();
    const table = createDataTable({
      projectId: project.id,
      name: "AI Table",
      columns: [],
      createdBy: "ai",
    });
    expect(table.createdBy).toBe("ai");
  });
});

describe("Data Table Row CRUD", () => {
  beforeEach(() => setupTestDb());

  it("inserts and retrieves rows", () => {
    const project = createTestProject();
    const table = createDataTable({
      projectId: project.id,
      name: "Customers",
      columns: TEST_COLUMNS,
    });

    const rows = insertDataTableRows({
      tableId: table.id,
      rows: [
        { col_name: "Acme Corp", col_status: "opt_lead", col_revenue: 5000 },
        { col_name: "Beta Inc", col_status: "opt_qual", col_revenue: 12000 },
      ],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].data.col_name).toBe("Acme Corp");
    expect(rows[1].data.col_revenue).toBe(12000);
    expect(rows[0].sortOrder).toBe(0);
    expect(rows[1].sortOrder).toBe(1);

    // Denormalized count updated
    const updatedTable = getDataTable(table.id);
    expect(updatedTable!.rowCount).toBe(2);
  });

  it("retrieves rows with pagination", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });

    const rowData = Array.from({ length: 10 }, (_, i) => ({
      col_name: `Row ${i}`,
    }));
    insertDataTableRows({ tableId: table.id, rows: rowData });

    const page1 = getDataTableRows({ tableId: table.id, limit: 3, offset: 0 });
    expect(page1).toHaveLength(3);
    expect(page1[0].data.col_name).toBe("Row 0");

    const page2 = getDataTableRows({ tableId: table.id, limit: 3, offset: 3 });
    expect(page2).toHaveLength(3);
    expect(page2[0].data.col_name).toBe("Row 3");
  });

  it("updates a row with merge semantics", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });

    const [row] = insertDataTableRows({
      tableId: table.id,
      rows: [{ col_name: "Acme", col_revenue: 5000 }],
    });

    const updated = updateDataTableRow({
      id: row.id,
      data: { col_revenue: 7500, col_status: "opt_qual" },
    });

    expect(updated.data.col_name).toBe("Acme"); // preserved
    expect(updated.data.col_revenue).toBe(7500); // updated
    expect(updated.data.col_status).toBe("opt_qual"); // added
  });

  it("deletes rows and updates count", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });

    const rows = insertDataTableRows({
      tableId: table.id,
      rows: [{ col_name: "A" }, { col_name: "B" }, { col_name: "C" }],
    });

    const deleted = deleteDataTableRows({ rowIds: [rows[0].id, rows[1].id] });
    expect(deleted).toBe(2);

    expect(countDataTableRows(table.id)).toBe(1);
    expect(getDataTable(table.id)!.rowCount).toBe(1);
  });

  it("gets sample rows", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });

    const rowData = Array.from({ length: 10 }, (_, i) => ({ col_name: `Row ${i}` }));
    insertDataTableRows({ tableId: table.id, rows: rowData });

    const samples = getSampleRows(table.id, 3);
    expect(samples).toHaveLength(3);
    expect(samples[0].data.col_name).toBe("Row 0");
  });

  it("cascades row deletion when table is deleted", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });
    insertDataTableRows({ tableId: table.id, rows: [{ col_name: "A" }] });

    deleteDataTable(table.id);
    expect(getDataTableRows({ tableId: table.id })).toHaveLength(0);
  });
});

describe("Data Table Schema Operations", () => {
  beforeEach(() => setupTestDb());

  it("adds a column", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });

    const newCol: DataTableColumn = { id: "col_email", name: "Email", type: "email", config: {} };
    const updated = addColumn({ tableId: table.id, column: newCol });

    // 3 user + 2 auto-injected timestamps + 1 newly added = 6.
    expect(updated.columns).toHaveLength(6);
    expect(updated.columns.find((c) => c.id === "col_email")).toBeDefined();
  });

  it("renames a column", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });

    const updated = renameColumn({ tableId: table.id, columnId: "col_name", newName: "Company" });
    const col = updated.columns.find((c) => c.id === "col_name");
    expect(col!.name).toBe("Company");
  });

  it("removes a column", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });

    const updated = removeColumn({ tableId: table.id, columnId: "col_revenue" });
    // 3 user + 2 auto-injected timestamps - 1 removed = 4.
    expect(updated.columns).toHaveLength(4);
    expect(updated.columns.find((c) => c.id === "col_revenue")).toBeUndefined();
  });

  it("throws on invalid column ID", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });

    expect(() => renameColumn({ tableId: table.id, columnId: "nonexistent", newName: "X" }))
      .toThrow("Column not found");
    expect(() => removeColumn({ tableId: table.id, columnId: "nonexistent" }))
      .toThrow("Column not found");
  });

  it("preserves existing row data when column is removed", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });
    insertDataTableRows({
      tableId: table.id,
      rows: [{ col_name: "Acme", col_revenue: 5000 }],
    });

    removeColumn({ tableId: table.id, columnId: "col_revenue" });

    // Row data still has the orphaned key (by design — data is preserved)
    const rows = getDataTableRows({ tableId: table.id });
    expect(rows[0].data.col_revenue).toBe(5000);
  });

  it("updateColumn merges a width patch into a single column", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });

    const updated = updateColumn({
      tableId: table.id,
      columnId: "col_revenue",
      patch: { width: 240 },
    });

    const col = updated.columns.find((c) => c.id === "col_revenue");
    expect(col?.width).toBe(240);
    // Other columns untouched
    expect(updated.columns.find((c) => c.id === "col_name")?.width).toBeUndefined();
  });

  it("updateColumn preserves the id even if the patch tries to change it", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });

    // Patch omits id (it's excluded from the type) — verify the original id is kept.
    const updated = updateColumn({
      tableId: table.id,
      columnId: "col_name",
      patch: { name: "Company" },
    });

    const col = updated.columns.find((c) => c.id === "col_name");
    expect(col?.name).toBe("Company");
    expect(col?.id).toBe("col_name");
  });

  it("updateColumn throws when column is missing", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });

    expect(() =>
      updateColumn({ tableId: table.id, columnId: "nonexistent", patch: { width: 200 } }),
    ).toThrow("Column not found");
  });

  it("reorderColumns rearranges user columns and preserves timestamp columns at the end", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });

    // Provide all 5 IDs (3 user + 2 timestamp) in the order we want.
    const allIds = table.columns.map((c) => c.id);
    const userIds = allIds.filter((id) => !id.startsWith("__"));
    const tsIds = allIds.filter((id) => id.startsWith("__"));
    const nextIds = ["col_revenue", "col_name", "col_status", ...tsIds];
    expect(userIds).toEqual(["col_name", "col_status", "col_revenue"]);

    const updated = reorderColumns({
      tableId: table.id,
      columnIds: nextIds,
    });

    expect(updated.columns.map((c) => c.id)).toEqual(nextIds);
  });

  it("reorderColumns keeps unmentioned columns at the end (defensive)", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });

    const updated = reorderColumns({
      tableId: table.id,
      columnIds: ["col_revenue"],
    });

    expect(updated.columns[0].id).toBe("col_revenue");
    // 3 user + 2 timestamp auto-injected = 5.
    expect(updated.columns).toHaveLength(5);
  });

  it("createDataTable auto-injects Created and Updated columns at the end", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });

    const last = table.columns[table.columns.length - 1];
    const secondLast = table.columns[table.columns.length - 2];
    expect(secondLast.type).toBe("created_time");
    expect(last.type).toBe("updated_time");
  });

  it("createDataTable does not duplicate timestamp columns when caller supplies them", () => {
    const project = createTestProject();
    const customTimestamps: DataTableColumn[] = [
      ...TEST_COLUMNS,
      { id: "my_created", name: "Added On", type: "created_time", config: {} },
      { id: "my_updated", name: "Changed On", type: "updated_time", config: {} },
    ];
    const table = createDataTable({ projectId: project.id, name: "T", columns: customTimestamps });
    // Should stay at 5 (the 3 user + caller-supplied 2 timestamps), not 7.
    expect(table.columns).toHaveLength(5);
    expect(table.columns.filter((c) => c.type === "created_time")).toHaveLength(1);
    expect(table.columns.filter((c) => c.type === "updated_time")).toHaveLength(1);
    expect(table.columns.find((c) => c.type === "created_time")?.id).toBe("my_created");
  });

  it("removed timestamp columns do not reappear on later operations", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });

    // Find the auto-injected Created column and remove it.
    const createdCol = table.columns.find((c) => c.type === "created_time");
    expect(createdCol).toBeDefined();
    const afterRemove = removeColumn({ tableId: table.id, columnId: createdCol!.id });
    expect(afterRemove.columns.find((c) => c.type === "created_time")).toBeUndefined();

    // Subsequent addColumn shouldn't bring it back.
    const afterAdd = addColumn({
      tableId: table.id,
      column: { id: "col_note", name: "Note", type: "text", config: {} },
    });
    expect(afterAdd.columns.find((c) => c.type === "created_time")).toBeUndefined();
  });

  it("reorderColumns throws when a provided id does not exist", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });

    expect(() =>
      reorderColumns({ tableId: table.id, columnIds: ["col_revenue", "col_missing"] }),
    ).toThrow("Column not found");
  });
});

describe("Data Table Change Log", () => {
  beforeEach(() => setupTestDb());

  it("logs insert changes", () => {
    const project = createTestProject();
    const job = createJob({
      projectId: project.id,
      name: "Test Job",
      prompt: "Do stuff",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });

    insertDataTableRows({
      tableId: table.id,
      rows: [{ col_name: "Acme" }],
      actor: "ai",
      runId: run.id,
    });

    const changes = listDataTableChanges({ tableId: table.id });
    expect(changes).toHaveLength(1);
    expect(changes[0].action).toBe("insert");
    expect(changes[0].actor).toBe("ai");
    expect(changes[0].runId).toBe(run.id);
  });

  it("logs update changes with diff", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });
    const [row] = insertDataTableRows({
      tableId: table.id,
      rows: [{ col_name: "Acme", col_revenue: 5000 }],
    });

    updateDataTableRow({ id: row.id, data: { col_revenue: 7500 }, actor: "user" });

    const changes = listDataTableChanges({ tableId: table.id });
    const updateChange = changes.find((c) => c.action === "update");
    expect(updateChange).toBeTruthy();
    expect(updateChange!.diff.old).toEqual({ col_name: "Acme", col_revenue: 5000 });
    expect(updateChange!.diff.new).toEqual({ col_name: "Acme", col_revenue: 7500 });
  });

  it("logs delete changes", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });
    const [row] = insertDataTableRows({
      tableId: table.id,
      rows: [{ col_name: "Acme" }],
    });

    deleteDataTableRows({ rowIds: [row.id], actor: "system" });

    const changes = listDataTableChanges({ tableId: table.id });
    const deleteChange = changes.find((c) => c.action === "delete");
    expect(deleteChange).toBeTruthy();
    expect(deleteChange!.actor).toBe("system");
  });

  it("logs schema changes", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });

    addColumn({
      tableId: table.id,
      column: { id: "col_new", name: "New", type: "text", config: {} },
      actor: "ai",
    });

    const changes = listDataTableChanges({ tableId: table.id });
    expect(changes).toHaveLength(1);
    expect(changes[0].action).toBe("schema_change");
    expect(changes[0].actor).toBe("ai");
  });
});

describe("Data Table Embeddings", () => {
  beforeEach(() => setupTestDb());

  it("stores and retrieves embeddings", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "T", columns: TEST_COLUMNS });

    const embedding = Array(384).fill(0.1);
    updateTableEmbedding(table.id, embedding);

    const tables = getTablesWithEmbeddings(project.id);
    expect(tables).toHaveLength(1);
    expect(tables[0].embedding).toEqual(embedding);
  });

  it("returns null embedding for tables without one", () => {
    const project = createTestProject();
    createDataTable({ projectId: project.id, name: "T", columns: [] });

    const tables = getTablesWithEmbeddings(project.id);
    expect(tables[0].embedding).toBeNull();
  });
});

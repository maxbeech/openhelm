import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../src/db/init.js";
import {
  createVisualization,
  getVisualization,
  listVisualizations,
  updateVisualization,
  deleteVisualization,
  countVisualizations,
  listAllVisualizations,
} from "../src/db/queries/visualizations.js";
import { createDataTable, deleteDataTable } from "../src/db/queries/data-tables.js";
import { createProject } from "../src/db/queries/projects.js";
import { createGoal } from "../src/db/queries/goals.js";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";
import type { DataTableColumn, VisualizationConfig } from "@openhelm/shared";

function setupTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "oo-viz-test-"));
  initDatabase(join(dir, "test.db"));
}

function createTestProject() {
  return createProject({ name: "Test Project", directoryPath: "/tmp/test" });
}

const TEST_COLUMNS: DataTableColumn[] = [
  { id: "col_date", name: "Date", type: "date", config: {} },
  { id: "col_revenue", name: "Revenue", type: "number", config: {} },
  { id: "col_count", name: "Count", type: "number", config: {} },
];

const LINE_CONFIG: VisualizationConfig = {
  xColumnId: "col_date",
  series: [
    { columnId: "col_revenue", label: "Revenue" },
  ],
  showLegend: false,
  showGrid: true,
};

describe("Visualization CRUD", () => {
  beforeEach(() => setupTestDb());

  it("creates a visualization", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "Sales", columns: TEST_COLUMNS });

    const viz = createVisualization({
      projectId: project.id,
      dataTableId: table.id,
      name: "Revenue Over Time",
      chartType: "line",
      config: LINE_CONFIG,
    });

    expect(viz.id).toBeDefined();
    expect(viz.name).toBe("Revenue Over Time");
    expect(viz.chartType).toBe("line");
    expect(viz.status).toBe("active");
    expect(viz.source).toBe("user");
    expect(viz.config.xColumnId).toBe("col_date");
    expect(viz.config.series).toHaveLength(1);
    expect(viz.config.series[0].columnId).toBe("col_revenue");
  });

  it("gets a visualization by id", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "Sales", columns: TEST_COLUMNS });

    const created = createVisualization({
      projectId: project.id,
      dataTableId: table.id,
      name: "Test Chart",
      chartType: "bar",
      config: { series: [{ columnId: "col_revenue" }] },
    });

    const fetched = getVisualization(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("Test Chart");
    expect(fetched!.chartType).toBe("bar");
  });

  it("returns null for non-existent visualization", () => {
    setupTestDb();
    const result = getVisualization("non-existent");
    expect(result).toBeNull();
  });

  it("lists visualizations by project", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "Sales", columns: TEST_COLUMNS });

    createVisualization({
      projectId: project.id,
      dataTableId: table.id,
      name: "Chart 1",
      chartType: "line",
      config: LINE_CONFIG,
    });
    createVisualization({
      projectId: project.id,
      dataTableId: table.id,
      name: "Chart 2",
      chartType: "bar",
      config: { series: [{ columnId: "col_count" }] },
    });

    const vizs = listVisualizations({ projectId: project.id });
    expect(vizs).toHaveLength(2);
  });

  it("filters visualizations by status", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "Sales", columns: TEST_COLUMNS });

    createVisualization({
      projectId: project.id,
      dataTableId: table.id,
      name: "Active Chart",
      chartType: "line",
      config: LINE_CONFIG,
      status: "active",
    });
    createVisualization({
      projectId: project.id,
      dataTableId: table.id,
      name: "Suggested Chart",
      chartType: "bar",
      config: { series: [{ columnId: "col_count" }] },
      status: "suggested",
    });

    const active = listVisualizations({ projectId: project.id, status: "active" });
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe("Active Chart");

    const suggested = listVisualizations({ projectId: project.id, status: "suggested" });
    expect(suggested).toHaveLength(1);
    expect(suggested[0].name).toBe("Suggested Chart");
  });

  it("filters visualizations by goal", () => {
    const project = createTestProject();
    const goal = createGoal({ projectId: project.id, name: "Revenue Goal" });
    const table = createDataTable({ projectId: project.id, name: "Sales", columns: TEST_COLUMNS });

    createVisualization({
      projectId: project.id,
      goalId: goal.id,
      dataTableId: table.id,
      name: "Goal Chart",
      chartType: "line",
      config: LINE_CONFIG,
    });
    createVisualization({
      projectId: project.id,
      dataTableId: table.id,
      name: "No Goal Chart",
      chartType: "bar",
      config: { series: [{ columnId: "col_count" }] },
    });

    const goalVizs = listVisualizations({ goalId: goal.id });
    expect(goalVizs).toHaveLength(1);
    expect(goalVizs[0].name).toBe("Goal Chart");
  });

  it("updates a visualization", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "Sales", columns: TEST_COLUMNS });

    const viz = createVisualization({
      projectId: project.id,
      dataTableId: table.id,
      name: "Original",
      chartType: "line",
      config: LINE_CONFIG,
    });

    const updated = updateVisualization({
      id: viz.id,
      name: "Updated Name",
      chartType: "area",
    });

    expect(updated.name).toBe("Updated Name");
    expect(updated.chartType).toBe("area");
    expect(updated.config.xColumnId).toBe("col_date"); // config unchanged
  });

  it("updates status from suggested to active (accept)", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "Sales", columns: TEST_COLUMNS });

    const viz = createVisualization({
      projectId: project.id,
      dataTableId: table.id,
      name: "Suggested",
      chartType: "line",
      config: LINE_CONFIG,
      status: "suggested",
      source: "system",
    });

    expect(viz.status).toBe("suggested");

    const accepted = updateVisualization({ id: viz.id, status: "active" });
    expect(accepted.status).toBe("active");
  });

  it("deletes a visualization", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "Sales", columns: TEST_COLUMNS });

    const viz = createVisualization({
      projectId: project.id,
      dataTableId: table.id,
      name: "To Delete",
      chartType: "line",
      config: LINE_CONFIG,
    });

    const deleted = deleteVisualization(viz.id);
    expect(deleted).toBe(true);
    expect(getVisualization(viz.id)).toBeNull();
  });

  it("returns false when deleting non-existent visualization", () => {
    setupTestDb();
    const deleted = deleteVisualization("non-existent");
    expect(deleted).toBe(false);
  });

  it("counts visualizations by project", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "Sales", columns: TEST_COLUMNS });

    expect(countVisualizations(project.id)).toBe(0);

    createVisualization({
      projectId: project.id,
      dataTableId: table.id,
      name: "Chart 1",
      chartType: "line",
      config: LINE_CONFIG,
    });

    expect(countVisualizations(project.id)).toBe(1);
  });

  it("cascades deletion when data table is deleted", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "Sales", columns: TEST_COLUMNS });

    createVisualization({
      projectId: project.id,
      dataTableId: table.id,
      name: "Chart",
      chartType: "line",
      config: LINE_CONFIG,
    });

    expect(countVisualizations(project.id)).toBe(1);

    // Delete the data table — should cascade
    deleteDataTable(table.id);

    expect(countVisualizations(project.id)).toBe(0);
  });

  it("lists all visualizations across projects", () => {
    const project1 = createProject({ name: "Project 1", directoryPath: "/tmp/p1" });
    const project2 = createProject({ name: "Project 2", directoryPath: "/tmp/p2" });
    const table1 = createDataTable({ projectId: project1.id, name: "T1", columns: TEST_COLUMNS });
    const table2 = createDataTable({ projectId: project2.id, name: "T2", columns: TEST_COLUMNS });

    createVisualization({
      projectId: project1.id,
      dataTableId: table1.id,
      name: "P1 Chart",
      chartType: "line",
      config: LINE_CONFIG,
    });
    createVisualization({
      projectId: project2.id,
      dataTableId: table2.id,
      name: "P2 Chart",
      chartType: "bar",
      config: { series: [{ columnId: "col_count" }] },
    });

    const all = listAllVisualizations();
    expect(all).toHaveLength(2);
  });
});

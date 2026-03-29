import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../src/db/init.js";
import {
  createTarget,
  getTarget,
  listTargets,
  updateTarget,
  deleteTarget,
} from "../src/db/queries/targets.js";
import {
  evaluateTarget,
  evaluateTargets,
} from "../src/data-tables/target-evaluator.js";
import {
  createDataTable,
  insertDataTableRows,
  deleteDataTable,
} from "../src/db/queries/data-tables.js";
import { createProject } from "../src/db/queries/projects.js";
import { createGoal } from "../src/db/queries/goals.js";
import { createJob } from "../src/db/queries/jobs.js";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";
import type { DataTableColumn } from "@openhelm/shared";

function setupTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "oo-target-test-"));
  initDatabase(join(dir, "test.db"));
}

function createTestProject() {
  return createProject({ name: "Test Project", directoryPath: "/tmp/test" });
}

const NUMBER_COLUMNS: DataTableColumn[] = [
  { id: "col_score", name: "Score", type: "number", config: {} },
  { id: "col_count", name: "Count", type: "number", config: {} },
  { id: "col_name", name: "Name", type: "text", config: {} },
];

describe("Target CRUD", () => {
  beforeEach(() => setupTestDb());

  it("creates a target for a goal", () => {
    const project = createTestProject();
    const goal = createGoal({ projectId: project.id, name: "Improve coverage" });
    const table = createDataTable({ projectId: project.id, name: "Metrics", columns: NUMBER_COLUMNS });

    const target = createTarget({
      goalId: goal.id,
      projectId: project.id,
      dataTableId: table.id,
      columnId: "col_score",
      targetValue: 80,
      direction: "gte",
      aggregation: "latest",
      label: "Test Coverage",
    });

    expect(target.id).toBeTruthy();
    expect(target.goalId).toBe(goal.id);
    expect(target.jobId).toBeNull();
    expect(target.targetValue).toBe(80);
    expect(target.direction).toBe("gte");
    expect(target.aggregation).toBe("latest");
    expect(target.label).toBe("Test Coverage");
  });

  it("creates a target for a job", () => {
    const project = createTestProject();
    const job = createJob({
      projectId: project.id,
      name: "Check metrics",
      prompt: "check",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const table = createDataTable({ projectId: project.id, name: "Metrics", columns: NUMBER_COLUMNS });

    const target = createTarget({
      jobId: job.id,
      projectId: project.id,
      dataTableId: table.id,
      columnId: "col_count",
      targetValue: 5,
      direction: "lte",
    });

    expect(target.jobId).toBe(job.id);
    expect(target.goalId).toBeNull();
    expect(target.direction).toBe("lte");
  });

  it("rejects target with both goalId and jobId", () => {
    const project = createTestProject();
    const goal = createGoal({ projectId: project.id, name: "g" });
    const job = createJob({ projectId: project.id, name: "j", prompt: "p", scheduleType: "manual", scheduleConfig: {} });
    const table = createDataTable({ projectId: project.id, name: "M", columns: NUMBER_COLUMNS });

    expect(() =>
      createTarget({ goalId: goal.id, jobId: job.id, projectId: project.id, dataTableId: table.id, columnId: "col_score", targetValue: 1 }),
    ).toThrow("Exactly one of goalId or jobId");
  });

  it("rejects target with neither goalId nor jobId", () => {
    const project = createTestProject();
    const table = createDataTable({ projectId: project.id, name: "M", columns: NUMBER_COLUMNS });

    expect(() =>
      createTarget({ projectId: project.id, dataTableId: table.id, columnId: "col_score", targetValue: 1 }),
    ).toThrow("Exactly one of goalId or jobId");
  });

  it("lists and filters targets", () => {
    const project = createTestProject();
    const goal = createGoal({ projectId: project.id, name: "g1" });
    const goal2 = createGoal({ projectId: project.id, name: "g2" });
    const table = createDataTable({ projectId: project.id, name: "M", columns: NUMBER_COLUMNS });

    createTarget({ goalId: goal.id, projectId: project.id, dataTableId: table.id, columnId: "col_score", targetValue: 80 });
    createTarget({ goalId: goal2.id, projectId: project.id, dataTableId: table.id, columnId: "col_count", targetValue: 10 });

    expect(listTargets({ goalId: goal.id })).toHaveLength(1);
    expect(listTargets({ goalId: goal2.id })).toHaveLength(1);
    expect(listTargets({ projectId: project.id })).toHaveLength(2);
  });

  it("updates a target", () => {
    const project = createTestProject();
    const goal = createGoal({ projectId: project.id, name: "g" });
    const table = createDataTable({ projectId: project.id, name: "M", columns: NUMBER_COLUMNS });
    const target = createTarget({ goalId: goal.id, projectId: project.id, dataTableId: table.id, columnId: "col_score", targetValue: 80 });

    const updated = updateTarget({ id: target.id, targetValue: 90, direction: "lte", label: "New label" });
    expect(updated.targetValue).toBe(90);
    expect(updated.direction).toBe("lte");
    expect(updated.label).toBe("New label");
  });

  it("deletes a target", () => {
    const project = createTestProject();
    const goal = createGoal({ projectId: project.id, name: "g" });
    const table = createDataTable({ projectId: project.id, name: "M", columns: NUMBER_COLUMNS });
    const target = createTarget({ goalId: goal.id, projectId: project.id, dataTableId: table.id, columnId: "col_score", targetValue: 80 });

    expect(deleteTarget(target.id)).toBe(true);
    expect(getTarget(target.id)).toBeNull();
  });
});

describe("Target Evaluator", () => {
  beforeEach(() => setupTestDb());

  it("evaluates target with latest aggregation", () => {
    const project = createTestProject();
    const goal = createGoal({ projectId: project.id, name: "g" });
    const table = createDataTable({ projectId: project.id, name: "M", columns: NUMBER_COLUMNS });

    insertDataTableRows({
      tableId: table.id,
      rows: [
        { col_score: 50 },
        { col_score: 67 },
        { col_score: 75 },
      ],
    });

    const target = createTarget({
      goalId: goal.id,
      projectId: project.id,
      dataTableId: table.id,
      columnId: "col_score",
      targetValue: 80,
      aggregation: "latest",
    });

    const ev = evaluateTarget(target);
    expect(ev.currentValue).toBe(75); // Latest by sortOrder
    expect(ev.targetValue).toBe(80);
    expect(ev.met).toBe(false);
    expect(ev.progress).toBeCloseTo(0.9375, 2);
    expect(ev.rowCount).toBe(3);
  });

  it("evaluates sum aggregation", () => {
    const project = createTestProject();
    const goal = createGoal({ projectId: project.id, name: "g" });
    const table = createDataTable({ projectId: project.id, name: "M", columns: NUMBER_COLUMNS });

    insertDataTableRows({ tableId: table.id, rows: [{ col_count: 10 }, { col_count: 20 }, { col_count: 30 }] });

    const target = createTarget({
      goalId: goal.id,
      projectId: project.id,
      dataTableId: table.id,
      columnId: "col_count",
      targetValue: 50,
      aggregation: "sum",
    });

    const ev = evaluateTarget(target);
    expect(ev.currentValue).toBe(60);
    expect(ev.met).toBe(true);
    expect(ev.progress).toBe(1);
  });

  it("evaluates avg aggregation", () => {
    const project = createTestProject();
    const goal = createGoal({ projectId: project.id, name: "g" });
    const table = createDataTable({ projectId: project.id, name: "M", columns: NUMBER_COLUMNS });

    insertDataTableRows({ tableId: table.id, rows: [{ col_score: 60 }, { col_score: 80 }] });

    const target = createTarget({
      goalId: goal.id,
      projectId: project.id,
      dataTableId: table.id,
      columnId: "col_score",
      targetValue: 70,
      aggregation: "avg",
    });

    const ev = evaluateTarget(target);
    expect(ev.currentValue).toBe(70);
    expect(ev.met).toBe(true);
  });

  it("evaluates lte direction", () => {
    const project = createTestProject();
    const goal = createGoal({ projectId: project.id, name: "g" });
    const table = createDataTable({ projectId: project.id, name: "M", columns: NUMBER_COLUMNS });

    insertDataTableRows({ tableId: table.id, rows: [{ col_score: 3 }] });

    const target = createTarget({
      goalId: goal.id,
      projectId: project.id,
      dataTableId: table.id,
      columnId: "col_score",
      targetValue: 5,
      direction: "lte",
      aggregation: "latest",
    });

    const ev = evaluateTarget(target);
    expect(ev.currentValue).toBe(3);
    expect(ev.met).toBe(true);
    expect(ev.progress).toBe(1);
  });

  it("evaluates count aggregation", () => {
    const project = createTestProject();
    const goal = createGoal({ projectId: project.id, name: "g" });
    const table = createDataTable({ projectId: project.id, name: "M", columns: NUMBER_COLUMNS });

    insertDataTableRows({
      tableId: table.id,
      rows: [{ col_score: 1 }, { col_score: 2 }, { col_name: "only text" }],
    });

    const target = createTarget({
      goalId: goal.id,
      projectId: project.id,
      dataTableId: table.id,
      columnId: "col_score",
      targetValue: 5,
      aggregation: "count",
    });

    const ev = evaluateTarget(target);
    expect(ev.currentValue).toBe(2); // 2 numeric values
    expect(ev.met).toBe(false);
    expect(ev.progress).toBeCloseTo(0.4, 2);
  });

  it("handles missing table gracefully", () => {
    const project = createTestProject();
    const goal = createGoal({ projectId: project.id, name: "g" });
    const table = createDataTable({ projectId: project.id, name: "M", columns: NUMBER_COLUMNS });
    const target = createTarget({
      goalId: goal.id,
      projectId: project.id,
      dataTableId: table.id,
      columnId: "col_score",
      targetValue: 80,
    });

    // Delete the table to simulate orphaned target
    deleteDataTable(table.id);

    const ev = evaluateTarget(target);
    expect(ev.currentValue).toBeNull();
    expect(ev.met).toBe(false);
    expect(ev.progress).toBe(0);
  });

  it("handles no rows gracefully", () => {
    const project = createTestProject();
    const goal = createGoal({ projectId: project.id, name: "g" });
    const table = createDataTable({ projectId: project.id, name: "M", columns: NUMBER_COLUMNS });
    const target = createTarget({
      goalId: goal.id,
      projectId: project.id,
      dataTableId: table.id,
      columnId: "col_score",
      targetValue: 80,
    });

    const ev = evaluateTarget(target);
    expect(ev.currentValue).toBeNull();
    expect(ev.met).toBe(false);
    expect(ev.progress).toBe(0);
  });

  it("evaluates overdue deadline", () => {
    const project = createTestProject();
    const goal = createGoal({ projectId: project.id, name: "g" });
    const table = createDataTable({ projectId: project.id, name: "M", columns: NUMBER_COLUMNS });

    insertDataTableRows({ tableId: table.id, rows: [{ col_score: 50 }] });

    const target = createTarget({
      goalId: goal.id,
      projectId: project.id,
      dataTableId: table.id,
      columnId: "col_score",
      targetValue: 80,
      deadline: "2020-01-01T00:00:00Z",
    });

    const ev = evaluateTarget(target);
    expect(ev.isOverdue).toBe(true);
    expect(ev.met).toBe(false);
  });

  it("evaluates multiple targets for a goal", () => {
    const project = createTestProject();
    const goal = createGoal({ projectId: project.id, name: "g" });
    const table = createDataTable({ projectId: project.id, name: "M", columns: NUMBER_COLUMNS });

    insertDataTableRows({ tableId: table.id, rows: [{ col_score: 90, col_count: 10 }] });

    createTarget({ goalId: goal.id, projectId: project.id, dataTableId: table.id, columnId: "col_score", targetValue: 80 });
    createTarget({ goalId: goal.id, projectId: project.id, dataTableId: table.id, columnId: "col_count", targetValue: 20 });

    const goalTargets = listTargets({ goalId: goal.id });
    const evaluations = evaluateTargets(goalTargets);
    expect(evaluations).toHaveLength(2);
    expect(evaluations.find((e) => e.met)).toBeTruthy();
    expect(evaluations.find((e) => !e.met)).toBeTruthy();
  });
});

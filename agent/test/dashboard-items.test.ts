import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createJob } from "../src/db/queries/jobs.js";
import { createRun } from "../src/db/queries/runs.js";
import {
  createDashboardItem,
  getDashboardItem,
  listDashboardItems,
  resolveDashboardItem,
  countOpenDashboardItems,
} from "../src/db/queries/dashboard-items.js";

let cleanup: () => void;
let projectId: string;
let projectId2: string;
let jobId: string;
let jobId2: string;
let runId: string;
let runId2: string;

beforeAll(() => {
  cleanup = setupTestDb();
  const project = createProject({ name: "Dashboard Test", directoryPath: "/tmp/dashboard" });
  projectId = project.id;
  const project2 = createProject({ name: "Dashboard Test 2", directoryPath: "/tmp/dashboard2" });
  projectId2 = project2.id;

  const job = createJob({
    projectId,
    name: "Dashboard Job",
    prompt: "test",
    scheduleType: "manual",
    scheduleConfig: {},
  });
  jobId = job.id;

  const job2 = createJob({
    projectId: projectId2,
    name: "Dashboard Job 2",
    prompt: "test2",
    scheduleType: "manual",
    scheduleConfig: {},
  });
  jobId2 = job2.id;

  const run = createRun({ jobId, triggerSource: "scheduled" });
  runId = run.id;

  const run2 = createRun({ jobId: jobId2, triggerSource: "scheduled" });
  runId2 = run2.id;
});

afterAll(() => cleanup());

describe("dashboard items CRUD", () => {
  it("creates a dashboard item", () => {
    const item = createDashboardItem({
      runId,
      jobId,
      projectId,
      type: "permanent_failure",
      title: "Test failure",
      message: "Something broke",
    });

    expect(item.id).toBeDefined();
    expect(item.type).toBe("permanent_failure");
    expect(item.status).toBe("open");
    expect(item.title).toBe("Test failure");
    expect(item.resolvedAt).toBeNull();
  });

  it("gets a dashboard item by id", () => {
    const item = createDashboardItem({
      runId,
      jobId,
      projectId,
      type: "human_in_loop",
      title: "Needs input",
      message: "Claude asked a question",
    });

    const found = getDashboardItem(item.id);
    expect(found).not.toBeNull();
    expect(found!.type).toBe("human_in_loop");
    expect(found!.title).toBe("Needs input");
  });

  it("returns null for non-existent item", () => {
    expect(getDashboardItem("nonexistent")).toBeNull();
  });

  it("lists dashboard items ordered by createdAt DESC", () => {
    const items = listDashboardItems();
    expect(items.length).toBeGreaterThanOrEqual(2);
    // Most recent first
    const dates = items.map((i) => new Date(i.createdAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
    }
  });

  it("filters by projectId", () => {
    createDashboardItem({
      runId: runId2,
      jobId: jobId2,
      projectId: projectId2,
      type: "permanent_failure",
      title: "Other project failure",
      message: "broke",
    });

    const p1Items = listDashboardItems({ projectId });
    const p2Items = listDashboardItems({ projectId: projectId2 });

    expect(p1Items.every((i) => i.projectId === projectId)).toBe(true);
    expect(p2Items.every((i) => i.projectId === projectId2)).toBe(true);
  });

  it("filters by status", () => {
    const openItems = listDashboardItems({ status: "open" });
    expect(openItems.every((i) => i.status === "open")).toBe(true);
  });

  it("resolves a dashboard item", () => {
    const item = createDashboardItem({
      runId,
      jobId,
      projectId,
      type: "permanent_failure",
      title: "To resolve",
      message: "will be dismissed",
    });

    const resolved = resolveDashboardItem(item.id, "dismissed");
    expect(resolved.status).toBe("dismissed");
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it("counts open dashboard items", () => {
    const total = countOpenDashboardItems();
    expect(total).toBeGreaterThanOrEqual(1);

    const forProject = countOpenDashboardItems(projectId);
    expect(forProject).toBeGreaterThanOrEqual(1);
    expect(forProject).toBeLessThanOrEqual(total);
  });

  it("count decreases when item is resolved", () => {
    const before = countOpenDashboardItems(projectId);
    const item = createDashboardItem({
      runId,
      jobId,
      projectId,
      type: "permanent_failure",
      title: "Count test",
      message: "test",
    });
    expect(countOpenDashboardItems(projectId)).toBe(before + 1);
    resolveDashboardItem(item.id, "resolved");
    expect(countOpenDashboardItems(projectId)).toBe(before);
  });
});

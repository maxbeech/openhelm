import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createJob } from "../src/db/queries/jobs.js";
import { createRun } from "../src/db/queries/runs.js";
import {
  createInboxItem,
  getInboxItem,
  listInboxItems,
  resolveInboxItem,
  countOpenInboxItems,
} from "../src/db/queries/inbox-items.js";

let cleanup: () => void;
let projectId: string;
let projectId2: string;
let jobId: string;
let jobId2: string;
let runId: string;
let runId2: string;

beforeAll(() => {
  cleanup = setupTestDb();
  const project = createProject({ name: "Inbox Test", directoryPath: "/tmp/inbox" });
  projectId = project.id;
  const project2 = createProject({ name: "Inbox Test 2", directoryPath: "/tmp/inbox2" });
  projectId2 = project2.id;

  const job = createJob({
    projectId,
    name: "Inbox Job",
    prompt: "test",
    scheduleType: "manual",
    scheduleConfig: {},
  });
  jobId = job.id;

  const job2 = createJob({
    projectId: projectId2,
    name: "Inbox Job 2",
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

describe("inbox items CRUD", () => {
  it("creates an inbox item", () => {
    const item = createInboxItem({
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

  it("gets an inbox item by id", () => {
    const item = createInboxItem({
      runId,
      jobId,
      projectId,
      type: "human_in_loop",
      title: "Needs input",
      message: "Claude asked a question",
    });

    const found = getInboxItem(item.id);
    expect(found).not.toBeNull();
    expect(found!.type).toBe("human_in_loop");
    expect(found!.title).toBe("Needs input");
  });

  it("returns null for non-existent item", () => {
    expect(getInboxItem("nonexistent")).toBeNull();
  });

  it("lists inbox items ordered by createdAt DESC", () => {
    const items = listInboxItems();
    expect(items.length).toBeGreaterThanOrEqual(2);
    // Most recent first
    const dates = items.map((i) => new Date(i.createdAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
    }
  });

  it("filters by projectId", () => {
    createInboxItem({
      runId: runId2,
      jobId: jobId2,
      projectId: projectId2,
      type: "permanent_failure",
      title: "Other project failure",
      message: "broke",
    });

    const p1Items = listInboxItems({ projectId });
    const p2Items = listInboxItems({ projectId: projectId2 });

    expect(p1Items.every((i) => i.projectId === projectId)).toBe(true);
    expect(p2Items.every((i) => i.projectId === projectId2)).toBe(true);
  });

  it("filters by status", () => {
    const openItems = listInboxItems({ status: "open" });
    expect(openItems.every((i) => i.status === "open")).toBe(true);
  });

  it("resolves an inbox item", () => {
    const item = createInboxItem({
      runId,
      jobId,
      projectId,
      type: "permanent_failure",
      title: "To resolve",
      message: "will be dismissed",
    });

    const resolved = resolveInboxItem(item.id, "dismissed");
    expect(resolved.status).toBe("dismissed");
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it("counts open inbox items", () => {
    const total = countOpenInboxItems();
    expect(total).toBeGreaterThanOrEqual(1);

    const forProject = countOpenInboxItems(projectId);
    expect(forProject).toBeGreaterThanOrEqual(1);
    expect(forProject).toBeLessThanOrEqual(total);
  });

  it("count decreases when item is resolved", () => {
    const before = countOpenInboxItems(projectId);
    const item = createInboxItem({
      runId,
      jobId,
      projectId,
      type: "permanent_failure",
      title: "Count test",
      message: "test",
    });
    expect(countOpenInboxItems(projectId)).toBe(before + 1);
    resolveInboxItem(item.id, "resolved");
    expect(countOpenInboxItems(projectId)).toBe(before);
  });
});

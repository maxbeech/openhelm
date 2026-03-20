import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createJob } from "../src/db/queries/jobs.js";
import {
  createRun,
  getRun,
  updateRun,
} from "../src/db/queries/runs.js";
import { listRunLogs } from "../src/db/queries/run-logs.js";
import {
  setSetting,
  getSetting,
  deleteSetting,
} from "../src/db/queries/settings.js";
import { JobQueue } from "../src/scheduler/queue.js";
import { Executor } from "../src/executor/index.js";

let cleanup: () => void;
let queue: JobQueue;

vi.mock("../src/scheduler/queue.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/scheduler/queue.js")>();
  return {
    ...orig,
    get jobQueue() {
      return queue;
    },
  };
});

vi.mock("../src/ipc/emitter.js", () => ({
  emit: vi.fn(),
  send: vi.fn(),
}));

vi.mock("../src/planner/failure-analyzer.js", () => ({
  analyzeFailure: vi.fn().mockResolvedValue(null),
}));

vi.mock("../src/planner/summarize.js", () => ({
  generateRunSummary: vi.fn().mockResolvedValue(null),
}));

vi.mock("../src/sentry.js", () => ({
  captureAgentError: vi.fn(),
  addAgentBreadcrumb: vi.fn(),
  isAnalyticsEnabled: vi.fn(() => false),
}));

/**
 * Helper to drain queue and collect all items by runId.
 * This avoids ordering issues from runs created by earlier tests.
 */
function drainQueue(): Map<string, { runId: string; priority: number }> {
  const items = new Map<string, { runId: string; priority: number }>();
  let item = queue.dequeue();
  while (item) {
    items.set(item.runId, { runId: item.runId, priority: item.priority });
    item = queue.dequeue();
  }
  return items;
}

beforeAll(() => {
  cleanup = setupTestDb();
});

afterAll(() => cleanup());

beforeEach(() => {
  queue = new JobQueue();
  try { deleteSetting("update_pending"); } catch { /* ok */ }
});

function createTestFixture() {
  const project = createProject({
    name: "Update Recovery",
    directoryPath: "/tmp",
  });
  const job = createJob({
    projectId: project.id,
    name: "Test Job",
    prompt: "do work",
    scheduleType: "interval",
    scheduleConfig: { minutes: 10 },
  });
  return { projectId: project.id, jobId: job.id };
}

describe("running → queued state transition", () => {
  it("allows running → queued (for update recovery)", () => {
    const { jobId } = createTestFixture();
    const run = createRun({ jobId, triggerSource: "manual" });
    updateRun({ id: run.id, status: "running", startedAt: new Date().toISOString() });
    const updated = updateRun({ id: run.id, status: "queued" });
    expect(updated.status).toBe("queued");
  });
});

describe("crash recovery without update_pending (crash)", () => {
  it("marks stuck running runs as failed", () => {
    const { jobId } = createTestFixture();
    const run = createRun({ jobId, triggerSource: "scheduled" });
    updateRun({ id: run.id, status: "running", startedAt: new Date().toISOString() });

    const executor = new Executor();
    executor.recoverFromCrash();

    const updated = getRun(run.id);
    expect(updated!.status).toBe("failed");
    expect(updated!.finishedAt).not.toBeNull();

    const logs = listRunLogs({ runId: run.id });
    expect(logs.some((l) => l.text.includes("interrupted by agent restart"))).toBe(true);
  });

  it("re-enqueues queued runs after crash", () => {
    const { jobId } = createTestFixture();
    const run = createRun({ jobId, triggerSource: "manual" });

    const executor = new Executor();
    executor.recoverFromCrash();

    expect(queue.has(run.id)).toBe(true);
  });
});

describe("crash recovery with update_pending (planned update)", () => {
  it("re-enqueues running runs instead of marking them failed", () => {
    const { jobId } = createTestFixture();
    setSetting("update_pending", "true");

    const run = createRun({ jobId, triggerSource: "scheduled" });
    updateRun({ id: run.id, status: "running", startedAt: new Date().toISOString() });

    const executor = new Executor();
    executor.recoverFromCrash();

    const updated = getRun(run.id);
    expect(updated!.status).toBe("queued");
    expect(queue.has(run.id)).toBe(true);

    const logs = listRunLogs({ runId: run.id });
    expect(logs.some((l) => l.text.includes("app update"))).toBe(true);
  });

  it("clears update_pending flag after recovery", () => {
    createTestFixture();
    setSetting("update_pending", "true");

    const executor = new Executor();
    executor.recoverFromCrash();

    const flag = getSetting("update_pending");
    expect(flag).toBeNull();
  });

  it("assigns correct priority when re-enqueuing update-interrupted runs", () => {
    const { jobId } = createTestFixture();
    setSetting("update_pending", "true");

    const manualRun = createRun({ jobId, triggerSource: "manual" });
    updateRun({ id: manualRun.id, status: "running", startedAt: new Date().toISOString() });

    const scheduledRun = createRun({ jobId, triggerSource: "scheduled" });
    updateRun({ id: scheduledRun.id, status: "running", startedAt: new Date().toISOString() });

    const executor = new Executor();
    executor.recoverFromCrash();

    const items = drainQueue();
    expect(items.get(manualRun.id)?.priority).toBe(0);
    expect(items.get(scheduledRun.id)?.priority).toBe(1);
  });

  it("does not double-enqueue runs that are both running and queued", () => {
    const { jobId } = createTestFixture();
    setSetting("update_pending", "true");

    const runningRun = createRun({ jobId, triggerSource: "manual" });
    updateRun({ id: runningRun.id, status: "running", startedAt: new Date().toISOString() });

    const queuedRun = createRun({ jobId, triggerSource: "scheduled" });

    const executor = new Executor();
    executor.recoverFromCrash();

    expect(queue.has(runningRun.id)).toBe(true);
    expect(queue.has(queuedRun.id)).toBe(true);
  });
});

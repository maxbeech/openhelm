import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createJob } from "../src/db/queries/jobs.js";
import {
  createRun,
  getRun,
  listRuns,
  updateRun,
  deleteRun,
} from "../src/db/queries/runs.js";
import { createRunLog, listRunLogs } from "../src/db/queries/run-logs.js";

let cleanup: () => void;
let projectId: string;
let jobId: string;

beforeAll(() => {
  cleanup = setupTestDb();
  const project = createProject({
    name: "Run Test Project",
    directoryPath: "/tmp/run-test",
  });
  projectId = project.id;
  const job = createJob({
    projectId,
    name: "Run Test Job",
    prompt: "test",
    scheduleType: "interval",
    scheduleConfig: { minutes: 10 },
  });
  jobId = job.id;
});

afterAll(() => {
  cleanup();
});

describe("run queries", () => {
  it("should create a run with default queued status", () => {
    const run = createRun({ jobId, triggerSource: "manual" });

    expect(run.id).toBeDefined();
    expect(run.jobId).toBe(jobId);
    expect(run.status).toBe("queued");
    expect(run.triggerSource).toBe("manual");
    expect(run.startedAt).toBeNull();
    expect(run.finishedAt).toBeNull();
    expect(run.exitCode).toBeNull();
    expect(run.summary).toBeNull();
    expect(run.createdAt).toBeDefined();
  });

  it("should get a run by id", () => {
    const created = createRun({ jobId, triggerSource: "scheduled" });
    const fetched = getRun(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.triggerSource).toBe("scheduled");
  });

  it("should return null for non-existent run", () => {
    expect(getRun("non-existent")).toBeNull();
  });

  it("should list runs with filters", () => {
    const all = listRuns({ jobId });
    expect(all.length).toBeGreaterThanOrEqual(2);

    const manual = listRuns({ jobId, status: "queued" });
    manual.forEach((r) => expect(r.status).toBe("queued"));
  });

  it("should list runs with pagination", () => {
    // Create several runs
    for (let i = 0; i < 5; i++) {
      createRun({ jobId, triggerSource: "manual" });
    }

    const page1 = listRuns({ jobId, limit: 3, offset: 0 });
    expect(page1.length).toBe(3);

    const page2 = listRuns({ jobId, limit: 3, offset: 3 });
    expect(page2.length).toBeGreaterThanOrEqual(1);

    // No overlap
    const ids1 = new Set(page1.map((r) => r.id));
    page2.forEach((r) => expect(ids1.has(r.id)).toBe(false));
  });

  it("should update run status and timestamps", () => {
    const run = createRun({ jobId, triggerSource: "manual" });
    const startedAt = new Date().toISOString();

    const running = updateRun({
      id: run.id,
      status: "running",
      startedAt,
    });
    expect(running.status).toBe("running");
    expect(running.startedAt).toBe(startedAt);

    const finishedAt = new Date().toISOString();
    const succeeded = updateRun({
      id: run.id,
      status: "succeeded",
      finishedAt,
      exitCode: 0,
      summary: "All tests passed",
    });
    expect(succeeded.status).toBe("succeeded");
    expect(succeeded.finishedAt).toBe(finishedAt);
    expect(succeeded.exitCode).toBe(0);
    expect(succeeded.summary).toBe("All tests passed");
  });

  it("should throw when updating non-existent run", () => {
    expect(() =>
      updateRun({ id: "non-existent", status: "running" }),
    ).toThrow("Run not found");
  });

  it("should delete a run", () => {
    const run = createRun({ jobId, triggerSource: "manual" });
    expect(deleteRun(run.id)).toBe(true);
    expect(getRun(run.id)).toBeNull();
  });
});

describe("run log queries", () => {
  it("should create log entries with auto-incrementing sequence", () => {
    const run = createRun({ jobId, triggerSource: "manual" });

    const log1 = createRunLog({
      runId: run.id,
      stream: "stdout",
      text: "Starting...",
    });
    expect(log1.sequence).toBe(1);
    expect(log1.stream).toBe("stdout");
    expect(log1.text).toBe("Starting...");

    const log2 = createRunLog({
      runId: run.id,
      stream: "stderr",
      text: "Warning: something",
    });
    expect(log2.sequence).toBe(2);

    const log3 = createRunLog({
      runId: run.id,
      stream: "stdout",
      text: "Done!",
    });
    expect(log3.sequence).toBe(3);
  });

  it("should list logs in order", () => {
    const run = createRun({ jobId, triggerSource: "manual" });

    createRunLog({ runId: run.id, stream: "stdout", text: "Line 1" });
    createRunLog({ runId: run.id, stream: "stdout", text: "Line 2" });
    createRunLog({ runId: run.id, stream: "stderr", text: "Line 3" });

    const logs = listRunLogs({ runId: run.id });
    expect(logs.length).toBe(3);
    expect(logs[0].sequence).toBe(1);
    expect(logs[1].sequence).toBe(2);
    expect(logs[2].sequence).toBe(3);
  });

  it("should list logs after a given sequence", () => {
    const run = createRun({ jobId, triggerSource: "manual" });

    createRunLog({ runId: run.id, stream: "stdout", text: "Line 1" });
    createRunLog({ runId: run.id, stream: "stdout", text: "Line 2" });
    createRunLog({ runId: run.id, stream: "stdout", text: "Line 3" });

    const after1 = listRunLogs({ runId: run.id, afterSequence: 1 });
    expect(after1.length).toBe(2);
    expect(after1[0].text).toBe("Line 2");
    expect(after1[1].text).toBe("Line 3");
  });
});

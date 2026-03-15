import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createJob } from "../src/db/queries/jobs.js";
import { createRun, updateRun } from "../src/db/queries/runs.js";

let cleanup: () => void;
let jobId: string;

beforeAll(() => {
  cleanup = setupTestDb();
  const project = createProject({
    name: "SM Test",
    directoryPath: "/tmp/sm-test",
  });
  const job = createJob({
    projectId: project.id,
    name: "SM Job",
    prompt: "test",
    scheduleType: "interval",
    scheduleConfig: { minutes: 10 },
  });
  jobId = job.id;
});

afterAll(() => cleanup());

describe("run status state machine", () => {
  it("allows queued → running", () => {
    const run = createRun({ jobId, triggerSource: "manual" });
    const updated = updateRun({ id: run.id, status: "running", startedAt: new Date().toISOString() });
    expect(updated.status).toBe("running");
  });

  it("allows queued → cancelled", () => {
    const run = createRun({ jobId, triggerSource: "manual" });
    const updated = updateRun({ id: run.id, status: "cancelled" });
    expect(updated.status).toBe("cancelled");
  });

  it("allows running → succeeded", () => {
    const run = createRun({ jobId, triggerSource: "manual" });
    updateRun({ id: run.id, status: "running", startedAt: new Date().toISOString() });
    const updated = updateRun({ id: run.id, status: "succeeded", exitCode: 0 });
    expect(updated.status).toBe("succeeded");
  });

  it("allows running → failed", () => {
    const run = createRun({ jobId, triggerSource: "manual" });
    updateRun({ id: run.id, status: "running", startedAt: new Date().toISOString() });
    const updated = updateRun({ id: run.id, status: "failed", exitCode: 1 });
    expect(updated.status).toBe("failed");
  });

  it("allows running → cancelled", () => {
    const run = createRun({ jobId, triggerSource: "manual" });
    updateRun({ id: run.id, status: "running", startedAt: new Date().toISOString() });
    const updated = updateRun({ id: run.id, status: "cancelled" });
    expect(updated.status).toBe("cancelled");
  });

  it("allows running → permanent_failure", () => {
    const run = createRun({ jobId, triggerSource: "manual" });
    updateRun({ id: run.id, status: "running", startedAt: new Date().toISOString() });
    const updated = updateRun({ id: run.id, status: "permanent_failure" });
    expect(updated.status).toBe("permanent_failure");
  });

  it("allows queued → permanent_failure", () => {
    const run = createRun({ jobId, triggerSource: "manual" });
    const updated = updateRun({ id: run.id, status: "permanent_failure" });
    expect(updated.status).toBe("permanent_failure");
  });

  it("allows failed → permanent_failure", () => {
    const run = createRun({ jobId, triggerSource: "manual" });
    updateRun({ id: run.id, status: "running", startedAt: new Date().toISOString() });
    updateRun({ id: run.id, status: "failed", exitCode: 1 });
    const updated = updateRun({ id: run.id, status: "permanent_failure" });
    expect(updated.status).toBe("permanent_failure");
  });

  it("rejects succeeded → running (terminal state)", () => {
    const run = createRun({ jobId, triggerSource: "manual" });
    updateRun({ id: run.id, status: "running", startedAt: new Date().toISOString() });
    updateRun({ id: run.id, status: "succeeded", exitCode: 0 });

    expect(() => updateRun({ id: run.id, status: "running" })).toThrow(
      "Invalid status transition: succeeded → running",
    );
  });

  it("rejects failed → queued (terminal state)", () => {
    const run = createRun({ jobId, triggerSource: "manual" });
    updateRun({ id: run.id, status: "running", startedAt: new Date().toISOString() });
    updateRun({ id: run.id, status: "failed", exitCode: 1 });

    expect(() => updateRun({ id: run.id, status: "queued" })).toThrow(
      "Invalid status transition",
    );
  });

  it("rejects cancelled → running (terminal state)", () => {
    const run = createRun({ jobId, triggerSource: "manual" });
    updateRun({ id: run.id, status: "cancelled" });

    expect(() => updateRun({ id: run.id, status: "running" })).toThrow(
      "Invalid status transition",
    );
  });

  it("rejects queued → succeeded (must go through running first)", () => {
    const run = createRun({ jobId, triggerSource: "manual" });

    expect(() => updateRun({ id: run.id, status: "succeeded" })).toThrow(
      "Invalid status transition: queued → succeeded",
    );
  });

  it("allows no-op when status is the same", () => {
    const run = createRun({ jobId, triggerSource: "manual" });
    const updated = updateRun({ id: run.id, status: "queued" });
    expect(updated.status).toBe("queued");
  });

  it("allows updates without status change", () => {
    const run = createRun({ jobId, triggerSource: "manual" });
    updateRun({ id: run.id, status: "running", startedAt: new Date().toISOString() });
    // Update summary without changing status
    const updated = updateRun({ id: run.id, summary: "Partial progress" });
    expect(updated.summary).toBe("Partial progress");
    expect(updated.status).toBe("running");
  });
});

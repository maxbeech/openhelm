import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createJob } from "../src/db/queries/jobs.js";
import { createRun, getRun, updateRun } from "../src/db/queries/runs.js";
import { listDashboardItems } from "../src/db/queries/dashboard-items.js";

// Mock the emitter
vi.mock("../src/ipc/emitter.js", () => ({
  emit: vi.fn(),
  send: vi.fn(),
}));

import { emit } from "../src/ipc/emitter.js";
import { triagePermanentFailure } from "../src/executor/failure-triage.js";

const mockEmit = vi.mocked(emit);

let cleanup: () => void;
let projectId: string;

beforeAll(() => {
  cleanup = setupTestDb();
  const project = createProject({
    name: "Triage Test",
    directoryPath: "/tmp/triage",
  });
  projectId = project.id;
});

afterAll(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
});

describe("triagePermanentFailure", () => {
  it("promotes failed run to permanent_failure", () => {
    const job = createJob({
      projectId,
      name: "Triage Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "scheduled" });
    // Transition to running then failed first
    updateRun({ id: run.id, status: "running", startedAt: new Date().toISOString() });
    updateRun({ id: run.id, status: "failed", exitCode: 1 });

    triagePermanentFailure(run.id, "Infrastructure issue");

    const updated = getRun(run.id);
    expect(updated!.status).toBe("permanent_failure");
  });

  it("creates a dashboard item", () => {
    const job = createJob({
      projectId,
      name: "Triage Dashboard Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "scheduled" });
    updateRun({ id: run.id, status: "running", startedAt: new Date().toISOString() });
    updateRun({ id: run.id, status: "failed", exitCode: 1 });

    triagePermanentFailure(run.id, "Bad config");

    const items = listDashboardItems({ projectId });
    const match = items.find((i) => i.runId === run.id);
    expect(match).toBeDefined();
    expect(match!.type).toBe("permanent_failure");
    expect(match!.title).toContain("Triage Dashboard Job");
  });

  it("emits run.statusChanged and dashboard.created events", () => {
    const job = createJob({
      projectId,
      name: "Event Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "scheduled" });
    updateRun({ id: run.id, status: "running", startedAt: new Date().toISOString() });
    updateRun({ id: run.id, status: "failed", exitCode: 1 });

    triagePermanentFailure(run.id, "reason");

    expect(mockEmit).toHaveBeenCalledWith("run.statusChanged", expect.objectContaining({
      runId: run.id,
      status: "permanent_failure",
      previousStatus: "failed",
    }));
    expect(mockEmit).toHaveBeenCalledWith("dashboard.created", expect.objectContaining({
      runId: run.id,
      type: "permanent_failure",
    }));
  });

  it("handles missing run gracefully", () => {
    // Should not throw
    triagePermanentFailure("nonexistent-run", "reason");
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

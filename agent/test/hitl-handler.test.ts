import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createJob } from "../src/db/queries/jobs.js";
import { createRun, updateRun } from "../src/db/queries/runs.js";
import { listInboxItems } from "../src/db/queries/inbox-items.js";

// Mock the emitter
vi.mock("../src/ipc/emitter.js", () => ({
  emit: vi.fn(),
  send: vi.fn(),
}));

import { emit } from "../src/ipc/emitter.js";
import { handleInteractiveDetected } from "../src/executor/hitl-handler.js";

const mockEmit = vi.mocked(emit);

let cleanup: () => void;
let projectId: string;

beforeAll(() => {
  cleanup = setupTestDb();
  const project = createProject({
    name: "HITL Test",
    directoryPath: "/tmp/hitl",
  });
  projectId = project.id;
});

afterAll(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleInteractiveDetected", () => {
  it("aborts the controller", () => {
    const job = createJob({
      projectId,
      name: "HITL Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "scheduled" });
    updateRun({ id: run.id, status: "running", startedAt: new Date().toISOString() });

    const controller = new AbortController();
    handleInteractiveDetected(run.id, "Permission prompt", controller);

    expect(controller.signal.aborted).toBe(true);
  });

  it("creates a human_in_loop inbox item", () => {
    const job = createJob({
      projectId,
      name: "HITL Inbox Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "scheduled" });
    updateRun({ id: run.id, status: "running", startedAt: new Date().toISOString() });

    const controller = new AbortController();
    handleInteractiveDetected(run.id, "Asked a question", controller);

    const items = listInboxItems({ projectId });
    const match = items.find((i) => i.runId === run.id);
    expect(match).toBeDefined();
    expect(match!.type).toBe("human_in_loop");
    expect(match!.title).toContain("HITL Inbox Job");
    expect(match!.message).toBe("Asked a question");
  });

  it("emits inbox.created event", () => {
    const job = createJob({
      projectId,
      name: "HITL Event Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "scheduled" });
    updateRun({ id: run.id, status: "running", startedAt: new Date().toISOString() });

    const controller = new AbortController();
    handleInteractiveDetected(run.id, "reason", controller);

    expect(mockEmit).toHaveBeenCalledWith("inbox.created", expect.objectContaining({
      runId: run.id,
      type: "human_in_loop",
    }));
  });

  it("handles missing run gracefully", () => {
    const controller = new AbortController();
    // Should not throw
    handleInteractiveDetected("nonexistent", "reason", controller);
    expect(controller.signal.aborted).toBe(true);
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

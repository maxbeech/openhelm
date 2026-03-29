import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createJob } from "../src/db/queries/jobs.js";
import { createRun, updateRun } from "../src/db/queries/runs.js";
import { listDashboardItems } from "../src/db/queries/dashboard-items.js";
import { getSetting, setSetting, deleteSetting } from "../src/db/queries/settings.js";

// Mock the emitter
vi.mock("../src/ipc/emitter.js", () => ({
  emit: vi.fn(),
  send: vi.fn(),
}));

// Mock the health check
vi.mock("../src/claude-code/detector.js", () => ({
  checkClaudeCodeHealth: vi.fn(),
}));

import { emit } from "../src/ipc/emitter.js";
import { checkClaudeCodeHealth } from "../src/claude-code/detector.js";
import {
  isAuthError,
  handleAuthFailure,
  getInterruptedRuns,
  clearInterruptedRuns,
  attemptAuthResume,
  getOrCreateSystemHealthJob,
} from "../src/executor/auth-monitor.js";

const mockEmit = vi.mocked(emit);
const mockHealthCheck = vi.mocked(checkClaudeCodeHealth);

let cleanup: () => void;
let projectId: string;

beforeAll(() => {
  cleanup = setupTestDb();
  const project = createProject({
    name: "Auth Monitor Test",
    directoryPath: "/tmp/auth-test",
  });
  projectId = project.id;
});

afterAll(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  // Clean up any leftover settings
  deleteSetting("auth_interrupted_runs");
  deleteSetting("scheduler_paused");
});

describe("isAuthError", () => {
  it("detects 'not logged in' patterns", () => {
    expect(isAuthError("Error: not logged in")).toBe(true);
    expect(isAuthError("User is not  logged  in to Claude")).toBe(true);
  });

  it("detects 'unauthenticated' pattern", () => {
    expect(isAuthError("Request failed: unauthenticated")).toBe(true);
  });

  it("detects 'session expired' pattern", () => {
    expect(isAuthError("Your session expired, please re-login")).toBe(true);
  });

  it("detects 'sign-in required' pattern", () => {
    expect(isAuthError("sign-in required")).toBe(true);
    expect(isAuthError("Sign In Required")).toBe(true);
  });

  it("detects 'login required' pattern", () => {
    expect(isAuthError("Error: login required")).toBe(true);
  });

  it("detects 'please log in' / 'please sign in'", () => {
    expect(isAuthError("please log in to continue")).toBe(true);
    expect(isAuthError("Please sign in first")).toBe(true);
  });

  it("detects 'authentication failed'", () => {
    expect(isAuthError("authentication failed")).toBe(true);
  });

  it("returns false for non-auth errors", () => {
    expect(isAuthError("Error: file not found")).toBe(false);
    expect(isAuthError("Process exited with code 1")).toBe(false);
    expect(isAuthError("npm install failed")).toBe(false);
    expect(isAuthError("")).toBe(false);
  });
});

describe("getOrCreateSystemHealthJob", () => {
  it("creates a sentinel job on first call", () => {
    const job = getOrCreateSystemHealthJob(projectId);
    expect(job).toBeDefined();
    expect(job.source).toBe("system");
    expect(job.systemCategory).toBe("health_monitoring");
    expect(job.isEnabled).toBe(false);
    expect(job.scheduleType).toBe("manual");
  });

  it("returns the same job on subsequent calls", () => {
    const job1 = getOrCreateSystemHealthJob(projectId);
    const job2 = getOrCreateSystemHealthJob(projectId);
    expect(job1.id).toBe(job2.id);
  });
});

describe("handleAuthFailure", () => {
  it("creates a dashboard item and pauses scheduler", () => {
    const job = createJob({
      projectId,
      name: "Auth Test Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "scheduled" });

    handleAuthFailure(run.id, job.id, projectId);

    // Check dashboard item was created
    const items = listDashboardItems({ projectId, status: "open" });
    const authItem = items.find((i) => i.type === "auth_required");
    expect(authItem).toBeDefined();
    expect(authItem!.title).toContain("authentication required");

    // Check scheduler was paused
    expect(getSetting("scheduler_paused")?.value).toBe("true");

    // Check interrupted runs were recorded
    const interrupted = getInterruptedRuns();
    expect(interrupted.some((r) => r.runId === run.id)).toBe(true);

    // Check events were emitted
    expect(mockEmit).toHaveBeenCalledWith("dashboard.created", expect.objectContaining({
      type: "auth_required",
    }));
    expect(mockEmit).toHaveBeenCalledWith("scheduler.statusChanged", expect.objectContaining({
      paused: true,
    }));
  });

  it("deduplicates — does not create duplicate alerts", () => {
    const job = createJob({
      projectId,
      name: "Dedup Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run1 = createRun({ jobId: job.id, triggerSource: "scheduled" });
    const run2 = createRun({ jobId: job.id, triggerSource: "scheduled" });

    handleAuthFailure(run1.id, job.id, projectId);
    mockEmit.mockClear();
    handleAuthFailure(run2.id, job.id, projectId);

    // Should NOT have emitted dashboard.created again
    expect(mockEmit).not.toHaveBeenCalledWith("dashboard.created", expect.anything());

    // But should have added both runs to interrupted list
    const interrupted = getInterruptedRuns();
    expect(interrupted.some((r) => r.runId === run1.id)).toBe(true);
    expect(interrupted.some((r) => r.runId === run2.id)).toBe(true);
  });
});

describe("interrupted runs tracking", () => {
  it("round-trips interrupted runs through settings", () => {
    clearInterruptedRuns();
    expect(getInterruptedRuns()).toEqual([]);

    handleAuthFailure("run-1", "job-1", projectId);
    handleAuthFailure("run-2", "job-2", projectId);

    const interrupted = getInterruptedRuns();
    expect(interrupted).toHaveLength(2);
    expect(interrupted[0].runId).toBe("run-1");
    expect(interrupted[1].runId).toBe("run-2");

    clearInterruptedRuns();
    expect(getInterruptedRuns()).toEqual([]);
  });
});

describe("attemptAuthResume", () => {
  it("returns error when health check fails", async () => {
    mockHealthCheck.mockResolvedValue({
      healthy: false,
      authenticated: false,
      error: "Not logged in",
    });

    const result = await attemptAuthResume(() => {});
    expect(result.success).toBe(false);
    expect(result.error).toBe("Not logged in");
    expect(result.resumed).toBe(0);
  });

  it("re-enqueues interrupted runs on success", async () => {
    mockHealthCheck.mockResolvedValue({
      healthy: true,
      authenticated: true,
    });

    // Set up interrupted runs
    const job = createJob({
      projectId,
      name: "Resume Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const failedRun = createRun({ jobId: job.id, triggerSource: "scheduled" });
    updateRun({ id: failedRun.id, status: "running", startedAt: new Date().toISOString() });
    updateRun({ id: failedRun.id, status: "failed" });
    setSetting("auth_interrupted_runs", JSON.stringify([{ runId: failedRun.id, jobId: job.id }]));

    const enqueuedItems: unknown[] = [];
    const result = await attemptAuthResume((item) => enqueuedItems.push(item));

    expect(result.success).toBe(true);
    expect(result.resumed).toBe(1);
    expect(enqueuedItems).toHaveLength(1);

    // Interrupted runs should be cleared
    expect(getInterruptedRuns()).toEqual([]);

    // Scheduler should be resumed
    expect(getSetting("scheduler_paused")).toBeNull();

    // Events should have been emitted
    expect(mockEmit).toHaveBeenCalledWith("run.created", expect.objectContaining({
      jobId: job.id,
    }));
    expect(mockEmit).toHaveBeenCalledWith("scheduler.statusChanged", expect.objectContaining({
      paused: false,
    }));
  });
});

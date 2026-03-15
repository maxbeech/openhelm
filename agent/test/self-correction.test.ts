import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createJob, getJob } from "../src/db/queries/jobs.js";
import {
  createRun,
  getRun,
  hasCorrectiveRun,
} from "../src/db/queries/runs.js";
import { createRunLog } from "../src/db/queries/run-logs.js";
import { setSetting, deleteSetting } from "../src/db/queries/settings.js";
import type { QueueItem } from "../src/scheduler/queue.js";
import type { FailureSignal } from "../src/executor/self-correction.js";

// Mock the emitter
vi.mock("../src/ipc/emitter.js", () => ({
  emit: vi.fn(),
  send: vi.fn(),
}));

// Mock the failure analyzer
vi.mock("../src/planner/failure-analyzer.js", () => ({
  analyzeFailure: vi.fn(),
}));

import { analyzeFailure } from "../src/planner/failure-analyzer.js";
import { attemptSelfCorrection, buildFallbackCorrection } from "../src/executor/self-correction.js";

const mockAnalyze = vi.mocked(analyzeFailure);

let cleanup: () => void;
let projectId: string;

beforeAll(() => {
  cleanup = setupTestDb();
  const project = createProject({
    name: "Self-Correction Test",
    directoryPath: "/tmp",
  });
  projectId = project.id;
  setSetting("claude_code_path", "/usr/bin/true");
});

afterAll(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
});

function makeEnqueueFn(): { fn: (item: QueueItem) => void; items: QueueItem[] } {
  const items: QueueItem[] = [];
  return { fn: (item) => items.push(item), items };
}

function makeSignal(overrides: Partial<FailureSignal> = {}): FailureSignal {
  return {
    isTimeout: false,
    isSilenceTimeout: false,
    exitCode: 1,
    failureContext: "The run exited with code 1.",
    ...overrides,
  };
}

describe("attemptSelfCorrection", () => {
  it("skips when auto-correction is disabled", async () => {
    setSetting("auto_correction_enabled", "false");

    const job = createJob({
      projectId,
      name: "Disabled Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "scheduled" });
    const { fn, items } = makeEnqueueFn();

    const result = await attemptSelfCorrection(run.id, job, fn);

    expect(result.attempted).toBe(false);
    expect(result.reason).toContain("disabled");
    expect(items).toHaveLength(0);
    expect(mockAnalyze).not.toHaveBeenCalled();

    // Re-enable for other tests
    deleteSetting("auto_correction_enabled");
  });

  it("skips corrective runs (loop prevention)", async () => {
    const job = createJob({
      projectId,
      name: "Loop Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const parentRun = createRun({ jobId: job.id, triggerSource: "manual" });
    const correctiveRun = createRun({
      jobId: job.id,
      triggerSource: "corrective",
      parentRunId: parentRun.id,
    });
    const { fn, items } = makeEnqueueFn();

    const result = await attemptSelfCorrection(correctiveRun.id, job, fn);

    expect(result.attempted).toBe(false);
    expect(result.reason).toContain("not retried");
    expect(items).toHaveLength(0);
  });

  it("skips when corrective run already exists (duplicate guard)", async () => {
    const job = createJob({
      projectId,
      name: "Dup Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const failedRun = createRun({ jobId: job.id, triggerSource: "scheduled" });
    // Pre-create a corrective run for this parent
    createRun({
      jobId: job.id,
      triggerSource: "corrective",
      parentRunId: failedRun.id,
    });
    const { fn, items } = makeEnqueueFn();

    const result = await attemptSelfCorrection(failedRun.id, job, fn);

    expect(result.attempted).toBe(false);
    expect(result.reason).toContain("already exists");
    expect(items).toHaveLength(0);
  });

  it("creates corrective run for fixable failure", async () => {
    const job = createJob({
      projectId,
      name: "Fixable Job",
      prompt: "fix the bug",
      scheduleType: "interval",
      scheduleConfig: { amount: 1, unit: "hours" },
    });
    const failedRun = createRun({ jobId: job.id, triggerSource: "scheduled" });
    createRunLog({ runId: failedRun.id, stream: "stderr", text: "Error: wrong path" });

    mockAnalyze.mockResolvedValueOnce({
      fixable: true,
      correction: "Use /src/bar.ts instead of /src/foo.ts",
      reason: "Wrong file path",
    });

    const { fn, items } = makeEnqueueFn();
    const result = await attemptSelfCorrection(failedRun.id, job, fn, makeSignal());

    expect(result.attempted).toBe(true);
    expect(result.correctiveRunId).toBeDefined();
    expect(result.reason).toBe("Wrong file path");

    // Verify corrective run was created
    const corrRun = getRun(result.correctiveRunId!);
    expect(corrRun).not.toBeNull();
    expect(corrRun!.triggerSource).toBe("corrective");
    expect(corrRun!.parentRunId).toBe(failedRun.id);
    expect(corrRun!.correctionContext).toContain("/src/bar.ts");

    // Verify job correction context was updated
    const updatedJob = getJob(job.id);
    expect(updatedJob!.correctionContext).toContain("/src/bar.ts");

    // Verify enqueued at priority 2
    expect(items).toHaveLength(1);
    expect(items[0].priority).toBe(2);
  });

  it("skips when failure is not fixable and returns notFixable flag", async () => {
    const job = createJob({
      projectId,
      name: "Not Fixable Job",
      prompt: "deploy",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const failedRun = createRun({ jobId: job.id, triggerSource: "scheduled" });
    createRunLog({ runId: failedRun.id, stream: "stderr", text: "ECONNREFUSED" });

    mockAnalyze.mockResolvedValueOnce({
      fixable: false,
      correction: null,
      reason: "Infrastructure issue",
    });

    const { fn, items } = makeEnqueueFn();
    const result = await attemptSelfCorrection(failedRun.id, job, fn, makeSignal());

    expect(result.attempted).toBe(false);
    expect(result.reason).toContain("Not fixable");
    expect(result.notFixable).toBe(true);
    expect(result.analysisReason).toBe("Infrastructure issue");
    expect(items).toHaveLength(0);
  });

  it("passes failureContext through to analyzeFailure", async () => {
    const job = createJob({
      projectId,
      name: "Context Pass Job",
      prompt: "fix the bug",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const failedRun = createRun({ jobId: job.id, triggerSource: "scheduled" });
    createRunLog({ runId: failedRun.id, stream: "stderr", text: "silence timeout" });

    mockAnalyze.mockResolvedValueOnce({
      fixable: true,
      correction: "Try alternative approach",
      reason: "Got stuck on browser flow",
    });

    const { fn } = makeEnqueueFn();
    const context = "The run was killed due to silence timeout.";
    await attemptSelfCorrection(failedRun.id, job, fn, makeSignal({
      isSilenceTimeout: true,
      failureContext: context,
    }));

    expect(mockAnalyze).toHaveBeenCalledWith(failedRun.id, job.prompt, context);
  });

  it("works without failureSignal (backward compat)", async () => {
    const job = createJob({
      projectId,
      name: "No Context Job",
      prompt: "fix the bug",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const failedRun = createRun({ jobId: job.id, triggerSource: "scheduled" });
    createRunLog({ runId: failedRun.id, stream: "stderr", text: "error" });

    mockAnalyze.mockResolvedValueOnce({
      fixable: false,
      correction: null,
      reason: "Not fixable",
    });

    const { fn } = makeEnqueueFn();
    await attemptSelfCorrection(failedRun.id, job, fn);

    expect(mockAnalyze).toHaveBeenCalledWith(failedRun.id, job.prompt, undefined);
  });

  it("returns analysisError for non-signal failures when analysis returns null", async () => {
    const job = createJob({
      projectId,
      name: "Analysis Fail Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const failedRun = createRun({ jobId: job.id, triggerSource: "scheduled" });
    createRunLog({ runId: failedRun.id, stream: "stderr", text: "error" });

    mockAnalyze.mockResolvedValueOnce(null);

    const { fn, items } = makeEnqueueFn();
    const result = await attemptSelfCorrection(failedRun.id, job, fn, makeSignal());

    expect(result.attempted).toBe(false);
    expect(result.reason).toContain("analysis failed");
    expect(result.analysisError).toBe(true);
    expect(items).toHaveLength(0);
  });

  // --- Tier 1 (signal-based) tests ---

  it("ALWAYS retries on timeout even when LLM analysis returns null", async () => {
    const job = createJob({
      projectId,
      name: "Timeout Retry Job",
      prompt: "long task",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const failedRun = createRun({ jobId: job.id, triggerSource: "scheduled" });
    createRunLog({ runId: failedRun.id, stream: "stderr", text: "Process killed" });

    // LLM analysis fails (returns null)
    mockAnalyze.mockResolvedValueOnce(null);

    const { fn, items } = makeEnqueueFn();
    const result = await attemptSelfCorrection(failedRun.id, job, fn, makeSignal({
      isTimeout: true,
      timeoutMinutes: 30,
    }));

    expect(result.attempted).toBe(true);
    expect(result.correctiveRunId).toBeDefined();
    expect(items).toHaveLength(1);

    // Should use fallback correction
    const corrRun = getRun(result.correctiveRunId!);
    expect(corrRun!.correctionContext).toContain("timed out after 30 minutes");
  });

  it("ALWAYS retries on silence timeout even when LLM analysis returns null", async () => {
    const job = createJob({
      projectId,
      name: "Silence Retry Job",
      prompt: "browser task",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const failedRun = createRun({ jobId: job.id, triggerSource: "scheduled" });
    createRunLog({ runId: failedRun.id, stream: "stderr", text: "No output" });

    mockAnalyze.mockResolvedValueOnce(null);

    const { fn, items } = makeEnqueueFn();
    const result = await attemptSelfCorrection(failedRun.id, job, fn, makeSignal({
      isSilenceTimeout: true,
    }));

    expect(result.attempted).toBe(true);
    expect(result.correctiveRunId).toBeDefined();
    expect(items).toHaveLength(1);

    const corrRun = getRun(result.correctiveRunId!);
    expect(corrRun!.correctionContext).toContain("stalled");
  });

  it("uses LLM correction for timeout when LLM succeeds", async () => {
    const job = createJob({
      projectId,
      name: "Timeout LLM Job",
      prompt: "long task",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const failedRun = createRun({ jobId: job.id, triggerSource: "scheduled" });
    createRunLog({ runId: failedRun.id, stream: "stderr", text: "Process killed" });

    mockAnalyze.mockResolvedValueOnce({
      fixable: true,
      correction: "Skip rows 1-16, start from row 17",
      reason: "Timeout — partial completion",
    });

    const { fn, items } = makeEnqueueFn();
    const result = await attemptSelfCorrection(failedRun.id, job, fn, makeSignal({
      isTimeout: true,
      timeoutMinutes: 30,
    }));

    expect(result.attempted).toBe(true);
    const corrRun = getRun(result.correctiveRunId!);
    expect(corrRun!.correctionContext).toContain("Skip rows 1-16");
  });

  it("retries on exit code 143 (SIGTERM) even when LLM says not fixable", async () => {
    const job = createJob({
      projectId,
      name: "SIGTERM Job",
      prompt: "task",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const failedRun = createRun({ jobId: job.id, triggerSource: "scheduled" });
    createRunLog({ runId: failedRun.id, stream: "stderr", text: "Terminated" });

    // LLM says not fixable — but signal says timeout, so we override
    mockAnalyze.mockResolvedValueOnce({
      fixable: false,
      correction: null,
      reason: "Process killed externally",
    });

    const { fn, items } = makeEnqueueFn();
    const result = await attemptSelfCorrection(failedRun.id, job, fn, makeSignal({
      isTimeout: true,
      exitCode: 143,
      timeoutMinutes: 30,
    }));

    expect(result.attempted).toBe(true);
    expect(items).toHaveLength(1);
    // Used fallback since LLM said not fixable (no correction)
    const corrRun = getRun(result.correctiveRunId!);
    expect(corrRun!.correctionContext).toContain("timed out after 30 minutes");
  });
});

describe("buildFallbackCorrection", () => {
  it("generates timeout fallback", () => {
    const text = buildFallbackCorrection({
      isTimeout: true,
      isSilenceTimeout: false,
      exitCode: null,
      timeoutMinutes: 45,
    });
    expect(text).toContain("timed out after 45 minutes");
    expect(text).toContain("skip");
  });

  it("generates silence timeout fallback", () => {
    const text = buildFallbackCorrection({
      isTimeout: false,
      isSilenceTimeout: true,
      exitCode: null,
    });
    expect(text).toContain("stalled");
    expect(text).toContain("different approach");
  });

  it("defaults to 30 minutes when timeoutMinutes not set", () => {
    const text = buildFallbackCorrection({
      isTimeout: true,
      isSilenceTimeout: false,
      exitCode: null,
    });
    expect(text).toContain("30 minutes");
  });
});

describe("hasCorrectiveRun", () => {
  it("returns true when corrective run exists", () => {
    const job = createJob({
      projectId,
      name: "Has Corrective",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const parentRun = createRun({ jobId: job.id, triggerSource: "scheduled" });
    createRun({
      jobId: job.id,
      triggerSource: "corrective",
      parentRunId: parentRun.id,
    });

    expect(hasCorrectiveRun(parentRun.id)).toBe(true);
  });

  it("returns false when no corrective run exists", () => {
    const job = createJob({
      projectId,
      name: "No Corrective",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "scheduled" });

    expect(hasCorrectiveRun(run.id)).toBe(false);
  });
});

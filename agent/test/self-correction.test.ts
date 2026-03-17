import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createJob, getJob } from "../src/db/queries/jobs.js";
import {
  createRun,
  getRun,
  updateRun,
  hasCorrectiveRun,
  getCorrectionChainDepth,
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

// Mock Sentry — keep analytics disabled in tests
vi.mock("../src/sentry.js", () => ({
  captureAgentError: vi.fn(),
  addAgentBreadcrumb: vi.fn(),
  isAnalyticsEnabled: vi.fn(() => false),
}));

import { analyzeFailure } from "../src/planner/failure-analyzer.js";
import {
  attemptSelfCorrection,
  buildFallbackCorrection,
  buildFallbackContinuationPrompt,
} from "../src/executor/self-correction.js";

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

  it("skips when max correction depth reached (default 2) and sets shouldTriage", async () => {
    const job = createJob({
      projectId,
      name: "Loop Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const originalRun = createRun({ jobId: job.id, triggerSource: "manual" });
    const corrective1 = createRun({
      jobId: job.id,
      triggerSource: "corrective",
      parentRunId: originalRun.id,
    });
    const corrective2 = createRun({
      jobId: job.id,
      triggerSource: "corrective",
      parentRunId: corrective1.id,
    });
    const { fn, items } = makeEnqueueFn();

    // depth=2, maxRetries=2 → should be blocked
    const result = await attemptSelfCorrection(corrective2.id, job, fn);

    expect(result.attempted).toBe(false);
    expect(result.shouldTriage).toBe(true);
    expect(result.reason).toContain("Max correction retries reached");
    expect(items).toHaveLength(0);
  });

  it("allows retry when depth < maxRetries (depth 1 of 2)", async () => {
    const job = createJob({
      projectId,
      name: "Depth 1 Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const originalRun = createRun({ jobId: job.id, triggerSource: "manual" });
    const corrective1 = createRun({
      jobId: job.id,
      triggerSource: "corrective",
      parentRunId: originalRun.id,
    });
    createRunLog({ runId: corrective1.id, stream: "stderr", text: "Error" });

    mockAnalyze.mockResolvedValueOnce({
      fixable: true,
      correction: "Try approach B",
      reason: "Wrong approach",
    });

    const { fn, items } = makeEnqueueFn();
    // depth=1, maxRetries=2 → should be allowed
    const result = await attemptSelfCorrection(corrective1.id, job, fn, makeSignal());

    expect(result.attempted).toBe(true);
    expect(items).toHaveLength(1);
  });

  it("respects max_correction_retries setting override", async () => {
    setSetting("max_correction_retries", "1");
    const job = createJob({
      projectId,
      name: "Override Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const originalRun = createRun({ jobId: job.id, triggerSource: "manual" });
    const corrective1 = createRun({
      jobId: job.id,
      triggerSource: "corrective",
      parentRunId: originalRun.id,
    });
    const { fn, items } = makeEnqueueFn();

    // depth=1, maxRetries=1 → should be blocked
    const result = await attemptSelfCorrection(corrective1.id, job, fn);

    expect(result.attempted).toBe(false);
    expect(result.shouldTriage).toBe(true);
    expect(items).toHaveLength(0);

    deleteSetting("max_correction_retries");
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
    expect(corrRun!.correctionNote).toContain("/src/bar.ts");

    // Verify job correction note IS set by self-correction
    const updatedJob = getJob(job.id);
    expect(updatedJob!.correctionNote).toContain("/src/bar.ts");

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

    expect(mockAnalyze).toHaveBeenCalledWith(failedRun.id, job.prompt, context, []);
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

    expect(mockAnalyze).toHaveBeenCalledWith(failedRun.id, job.prompt, undefined, []);
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
    expect(corrRun!.correctionNote).toContain("timed out after 30 minutes");
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
    expect(corrRun!.correctionNote).toContain("stalled");
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
    expect(corrRun!.correctionNote).toContain("Skip rows 1-16");
  });

  it("stores continuationPrompt on corrective run when parent has sessionId", async () => {
    const job = createJob({
      projectId,
      name: "Session Resume Job",
      prompt: "fix the bug",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const failedRun = createRun({ jobId: job.id, triggerSource: "scheduled" });
    // Simulate: the failed run had a session
    updateRun({ id: failedRun.id, sessionId: "session-abc-123" });
    createRunLog({ runId: failedRun.id, stream: "stderr", text: "Error: wrong path" });

    mockAnalyze.mockResolvedValueOnce({
      fixable: true,
      correction: "Use /src/bar.ts instead of /src/foo.ts",
      continuationPrompt: "The previous attempt used the wrong file path. Try /src/bar.ts instead.",
      reason: "Wrong file path",
    });

    const { fn, items } = makeEnqueueFn();
    const result = await attemptSelfCorrection(failedRun.id, job, fn, makeSignal());

    expect(result.attempted).toBe(true);
    const corrRun = getRun(result.correctiveRunId!);
    // Corrective run stores the continuation prompt (not the correction)
    expect(corrRun!.correctionNote).toContain("previous attempt used the wrong file path");
    // Job-level correction note stores the persistent correction
    const updatedJob = getJob(job.id);
    expect(updatedJob!.correctionNote).toContain("/src/bar.ts");
  });

  it("falls back to correction text when parent has no sessionId", async () => {
    const job = createJob({
      projectId,
      name: "No Session Job",
      prompt: "fix the bug",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const failedRun = createRun({ jobId: job.id, triggerSource: "scheduled" });
    // No sessionId on the failed run
    createRunLog({ runId: failedRun.id, stream: "stderr", text: "Error: wrong path" });

    mockAnalyze.mockResolvedValueOnce({
      fixable: true,
      correction: "Use /src/bar.ts",
      continuationPrompt: "Try /src/bar.ts instead.",
      reason: "Wrong file path",
    });

    const { fn, items } = makeEnqueueFn();
    const result = await attemptSelfCorrection(failedRun.id, job, fn, makeSignal());

    expect(result.attempted).toBe(true);
    const corrRun = getRun(result.correctiveRunId!);
    // Without sessionId, corrective run stores the regular correction text
    expect(corrRun!.correctionNote).toBe("Use /src/bar.ts");
  });

  it("uses fallback continuation prompt for signal retry with sessionId but no LLM result", async () => {
    const job = createJob({
      projectId,
      name: "Fallback Continuation Job",
      prompt: "long task",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const failedRun = createRun({ jobId: job.id, triggerSource: "scheduled" });
    updateRun({ id: failedRun.id, sessionId: "session-xyz-789" });
    createRunLog({ runId: failedRun.id, stream: "stderr", text: "Process killed" });

    // LLM fails
    mockAnalyze.mockResolvedValueOnce(null);

    const { fn, items } = makeEnqueueFn();
    const result = await attemptSelfCorrection(failedRun.id, job, fn, makeSignal({
      isTimeout: true,
      timeoutMinutes: 30,
    }));

    expect(result.attempted).toBe(true);
    const corrRun = getRun(result.correctiveRunId!);
    // With sessionId, should use fallback continuation prompt (not fallback correction)
    expect(corrRun!.correctionNote).toContain("previous attempt was terminated");
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
    expect(corrRun!.correctionNote).toContain("timed out after 30 minutes");
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

describe("buildFallbackContinuationPrompt", () => {
  it("generates timeout continuation prompt", () => {
    const text = buildFallbackContinuationPrompt({
      isTimeout: true,
      isSilenceTimeout: false,
      exitCode: null,
      timeoutMinutes: 45,
    });
    expect(text).toContain("terminated after 45 minutes");
    expect(text).toContain("skip completed steps");
  });

  it("generates silence timeout continuation prompt", () => {
    const text = buildFallbackContinuationPrompt({
      isTimeout: false,
      isSilenceTimeout: true,
      exitCode: null,
    });
    expect(text).toContain("stalled");
    expect(text).toContain("different approach");
  });

  it("defaults to 30 minutes when timeoutMinutes not set", () => {
    const text = buildFallbackContinuationPrompt({
      isTimeout: true,
      isSilenceTimeout: false,
      exitCode: null,
    });
    expect(text).toContain("30 minutes");
  });
});

describe("getCorrectionChainDepth", () => {
  it("returns 0 for a non-corrective run", () => {
    const job = createJob({
      projectId,
      name: "Depth 0",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "scheduled" });
    expect(getCorrectionChainDepth(run.id)).toBe(0);
  });

  it("returns 1 for a single corrective run", () => {
    const job = createJob({
      projectId,
      name: "Depth 1",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const original = createRun({ jobId: job.id, triggerSource: "scheduled" });
    const corrective = createRun({
      jobId: job.id,
      triggerSource: "corrective",
      parentRunId: original.id,
    });
    expect(getCorrectionChainDepth(corrective.id)).toBe(1);
  });

  it("returns 2 for a chain of 2 corrective runs", () => {
    const job = createJob({
      projectId,
      name: "Depth 2",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const original = createRun({ jobId: job.id, triggerSource: "scheduled" });
    const corr1 = createRun({
      jobId: job.id,
      triggerSource: "corrective",
      parentRunId: original.id,
    });
    const corr2 = createRun({
      jobId: job.id,
      triggerSource: "corrective",
      parentRunId: corr1.id,
    });
    expect(getCorrectionChainDepth(corr2.id)).toBe(2);
  });

  it("respects maxWalk limit", () => {
    const job = createJob({
      projectId,
      name: "Depth Max",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const original = createRun({ jobId: job.id, triggerSource: "scheduled" });
    let prev = original;
    for (let i = 0; i < 5; i++) {
      prev = createRun({
        jobId: job.id,
        triggerSource: "corrective",
        parentRunId: prev.id,
      });
    }
    // maxWalk=3 should cap at 3
    expect(getCorrectionChainDepth(prev.id, 3)).toBe(3);
    // Default maxWalk should get all 5
    expect(getCorrectionChainDepth(prev.id)).toBe(5);
  });
});

describe("cumulative previousAttempts", () => {
  it("passes previous attempts to analyzeFailure for chained corrections", async () => {
    const job = createJob({
      projectId,
      name: "Cumulative Job",
      prompt: "test task",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const original = createRun({ jobId: job.id, triggerSource: "manual" });
    const corrective1 = createRun({
      jobId: job.id,
      triggerSource: "corrective",
      parentRunId: original.id,
      correctionNote: "Try approach A",
    });
    updateRun({ id: corrective1.id, summary: "Failed with approach A" });

    // corrective1 failed, now attempting correction from corrective1
    // Depth is 1 (corrective1 is corrective) — allowed under default max 2
    createRunLog({ runId: corrective1.id, stream: "stderr", text: "Error" });

    mockAnalyze.mockResolvedValueOnce({
      fixable: true,
      correction: "Try approach B instead",
      reason: "Approach A failed",
    });

    const { fn } = makeEnqueueFn();
    await attemptSelfCorrection(corrective1.id, job, fn, makeSignal());

    // Should have been called with previousAttempts containing the parent's info
    expect(mockAnalyze).toHaveBeenCalledWith(
      corrective1.id,
      job.prompt,
      "The run exited with code 1.",
      expect.arrayContaining([
        expect.objectContaining({
          correctionNote: "Try approach A",
        }),
      ]),
    );
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

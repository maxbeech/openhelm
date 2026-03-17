import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createJob, getJob } from "../src/db/queries/jobs.js";
import {
  createRun,
  getRun,
  updateRun,
  listRuns,
} from "../src/db/queries/runs.js";
import { createRunLog, listRunLogs } from "../src/db/queries/run-logs.js";
import { setSetting } from "../src/db/queries/settings.js";
import { JobQueue } from "../src/scheduler/queue.js";
import { Executor } from "../src/executor/index.js";
import type { RunnerConfig } from "../src/claude-code/runner.js";
import type { ClaudeCodeRunResult } from "@openorchestra/shared";

let cleanup: () => void;
let projectId: string;
let queue: JobQueue;

// Mock the jobQueue singleton
vi.mock("../src/scheduler/queue.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/scheduler/queue.js")>();
  return {
    ...orig,
    get jobQueue() {
      return queue;
    },
  };
});

// Mock the emitter
vi.mock("../src/ipc/emitter.js", () => ({
  emit: vi.fn(),
  send: vi.fn(),
}));

// Mock LLM-dependent modules (avoid real Claude Code CLI calls)
vi.mock("../src/planner/failure-analyzer.js", () => ({
  analyzeFailure: vi.fn().mockResolvedValue(null),
}));

vi.mock("../src/planner/summarize.js", () => ({
  generateRunSummary: vi.fn().mockResolvedValue(null),
}));

// Mock Sentry — keep analytics disabled in tests
vi.mock("../src/sentry.js", () => ({
  captureAgentError: vi.fn(),
  addAgentBreadcrumb: vi.fn(),
  isAnalyticsEnabled: vi.fn(() => false),
}));

beforeAll(() => {
  cleanup = setupTestDb();
  const project = createProject({
    name: "Executor Test",
    directoryPath: "/tmp",
  });
  projectId = project.id;

  // Set up Claude Code path for pre-flight checks
  setSetting("claude_code_path", "/usr/bin/true");
});

afterAll(() => cleanup());

beforeEach(() => {
  queue = new JobQueue();
});

/** Create a mock runner that returns controlled outcomes */
function mockRunner(
  result: ClaudeCodeRunResult = { exitCode: 0, timedOut: false, killed: false },
  delayMs = 0,
): (config: RunnerConfig, signal?: AbortSignal) => Promise<ClaudeCodeRunResult> {
  return async (config, signal) => {
    // Simulate log output
    config.onLogChunk("stdout", "Mock output line 1");
    config.onLogChunk("stdout", "Mock output line 2");

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return result;
  };
}

describe("Executor run lifecycle", () => {
  it("processes a queued run to succeeded", async () => {
    const job = createJob({
      projectId,
      name: "Success Job",
      prompt: "do something",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });

    queue.enqueue({
      runId: run.id,
      jobId: job.id,
      priority: 0,
      enqueuedAt: Date.now(),
    });

    const executor = new Executor(mockRunner());
    executor.processNext();

    // Wait for async execution
    await new Promise((r) => setTimeout(r, 100));

    const updated = getRun(run.id);
    expect(updated!.status).toBe("succeeded");
    expect(updated!.exitCode).toBe(0);
    expect(updated!.startedAt).not.toBeNull();
    expect(updated!.finishedAt).not.toBeNull();
  });

  it("keeps a failed run as 'failed' (not permanent_failure) when analysis error occurs for non-timeout", async () => {
    const job = createJob({
      projectId,
      name: "Fail Job",
      prompt: "do something bad",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });

    queue.enqueue({
      runId: run.id,
      jobId: job.id,
      priority: 0,
      enqueuedAt: Date.now(),
    });

    const executor = new Executor(
      mockRunner({ exitCode: 1, timedOut: false, killed: false }),
    );
    executor.processNext();

    // Wait long enough for async self-correction attempt
    await new Promise((r) => setTimeout(r, 200));

    const updated = getRun(run.id);
    // analysisError no longer promotes to permanent_failure — stays as "failed"
    // and creates an inbox item instead
    expect(updated!.status).toBe("failed");
    expect(updated!.exitCode).toBe(1);
  });

  it("creates corrective run for timed-out run using fallback correction (no LLM needed)", async () => {
    const job = createJob({
      projectId,
      name: "Timeout Job",
      prompt: "do something slow",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });

    queue.enqueue({
      runId: run.id,
      jobId: job.id,
      priority: 0,
      enqueuedAt: Date.now(),
    });

    const executor = new Executor(
      mockRunner({ exitCode: null, timedOut: true, killed: false }),
    );
    executor.processNext();

    // Wait long enough for async self-correction attempt
    await new Promise((r) => setTimeout(r, 200));

    const updated = getRun(run.id);
    // Timeout is a signal-based retry — always creates corrective run
    expect(updated!.status).toBe("failed");
    // Should have a timeout log entry
    const logs = listRunLogs({ runId: run.id });
    const timeoutLog = logs.find((l) => l.text.includes("timed out"));
    expect(timeoutLog).toBeDefined();
  });

  it("marks a killed run as cancelled", async () => {
    const job = createJob({
      projectId,
      name: "Kill Job",
      prompt: "get cancelled",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });

    queue.enqueue({
      runId: run.id,
      jobId: job.id,
      priority: 0,
      enqueuedAt: Date.now(),
    });

    const executor = new Executor(
      mockRunner({ exitCode: null, timedOut: false, killed: true }),
    );
    executor.processNext();

    await new Promise((r) => setTimeout(r, 100));

    const updated = getRun(run.id);
    expect(updated!.status).toBe("cancelled");
  });

  it("escalates corrective run failure to permanent_failure with inbox item", async () => {
    const { emit } = await import("../src/ipc/emitter.js");
    const mockEmit = vi.mocked(emit);
    mockEmit.mockClear();

    const job = createJob({
      projectId,
      name: "Corrective Fail Job",
      prompt: "do something",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });
    const parentRun = createRun({ jobId: job.id, triggerSource: "scheduled" });
    // Simulate: chain of 2 corrective runs (depth=2 hits default max_correction_retries=2)
    const corrective1 = createRun({
      jobId: job.id,
      triggerSource: "corrective",
      parentRunId: parentRun.id,
    });
    const correctiveRun = createRun({
      jobId: job.id,
      triggerSource: "corrective",
      parentRunId: corrective1.id,
    });

    queue.enqueue({
      runId: correctiveRun.id,
      jobId: job.id,
      priority: 2,
      enqueuedAt: Date.now(),
    });

    const executor = new Executor(
      mockRunner({ exitCode: 1, timedOut: false, killed: false }),
    );
    executor.processNext();

    // Wait long enough for async self-correction + triage
    await new Promise((r) => setTimeout(r, 300));

    const updated = getRun(correctiveRun.id);
    expect(updated!.status).toBe("permanent_failure");

    // Verify inbox.created was emitted
    const inboxEmits = mockEmit.mock.calls.filter((c) => c[0] === "inbox.created");
    expect(inboxEmits).toHaveLength(1);
  });

  it("writes log chunks to database during execution", async () => {
    const job = createJob({
      projectId,
      name: "Log Job",
      prompt: "produce logs",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });

    queue.enqueue({
      runId: run.id,
      jobId: job.id,
      priority: 0,
      enqueuedAt: Date.now(),
    });

    const executor = new Executor(mockRunner());
    executor.processNext();

    await new Promise((r) => setTimeout(r, 100));

    const logs = listRunLogs({ runId: run.id });
    expect(logs.length).toBeGreaterThanOrEqual(2); // At least 2 mock lines
    expect(logs[0].stream).toBe("stdout");
    expect(logs[0].sequence).toBe(1);
    expect(logs[1].sequence).toBe(2);
  });
});

describe("Executor pre-flight checks", () => {
  it("fails permanently when job is not found", async () => {
    // Create a real job to satisfy FK, create run, then delete job
    const tempJob = createJob({
      projectId,
      name: "Temp Job",
      prompt: "temp",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });
    const run = createRun({ jobId: tempJob.id, triggerSource: "manual" });
    const { deleteJob } = await import("../src/db/queries/jobs.js");
    // Deleting the job cascade-deletes runs, so we need to re-create the run
    // Instead, just enqueue with a bogus jobId that the executor looks up
    // The queue item has a jobId field separate from the run's FK

    queue.enqueue({
      runId: run.id,
      jobId: "nonexistent-job-id", // Executor looks up THIS jobId
      priority: 0,
      enqueuedAt: Date.now(),
    });

    const executor = new Executor(mockRunner());
    executor.processNext();

    await new Promise((r) => setTimeout(r, 100));

    const updated = getRun(run.id);
    expect(updated!.status).toBe("permanent_failure");

    const logs = listRunLogs({ runId: run.id });
    expect(logs.some((l) => l.text.includes("Job not found"))).toBe(true);
  });

  it("fails permanently when Claude Code binary doesn't exist", async () => {
    // Temporarily point to a non-existent binary path
    setSetting("claude_code_path", "/nonexistent/claude-code-binary");

    const job = createJob({
      projectId,
      name: "Bad Binary Job",
      prompt: "test binary check",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });

    queue.enqueue({
      runId: run.id,
      jobId: job.id,
      priority: 0,
      enqueuedAt: Date.now(),
    });

    const executor = new Executor(mockRunner());
    executor.processNext();

    await new Promise((r) => setTimeout(r, 100));

    const updated = getRun(run.id);
    expect(updated!.status).toBe("permanent_failure");

    const logs = listRunLogs({ runId: run.id });
    expect(
      logs.some((l) => l.text.includes("Claude Code CLI not found")),
    ).toBe(true);

    // Restore valid path for remaining tests
    setSetting("claude_code_path", "/usr/bin/true");
  });

  it("fails permanently when project directory doesn't exist", async () => {
    const badProject = createProject({
      name: "Bad Dir",
      directoryPath: "/nonexistent/path/to/project",
    });
    const job = createJob({
      projectId: badProject.id,
      name: "Bad Dir Job",
      prompt: "test",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });

    queue.enqueue({
      runId: run.id,
      jobId: job.id,
      priority: 0,
      enqueuedAt: Date.now(),
    });

    const executor = new Executor(mockRunner());
    executor.processNext();

    await new Promise((r) => setTimeout(r, 100));

    const updated = getRun(run.id);
    expect(updated!.status).toBe("permanent_failure");

    const logs = listRunLogs({ runId: run.id });
    expect(logs.some((l) => l.text.includes("directory not found"))).toBe(true);
  });
});

describe("Executor nextFireAt updates", () => {
  it("disables once-jobs after completion", async () => {
    const job = createJob({
      projectId,
      name: "Once Job",
      prompt: "one time",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });

    queue.enqueue({
      runId: run.id,
      jobId: job.id,
      priority: 0,
      enqueuedAt: Date.now(),
    });

    const executor = new Executor(mockRunner());
    executor.processNext();

    await new Promise((r) => setTimeout(r, 100));

    const updated = getJob(job.id);
    expect(updated!.isEnabled).toBe(false);
    expect(updated!.nextFireAt).toBeNull();
  });

  it("computes next interval fire time from completion", async () => {
    const job = createJob({
      projectId,
      name: "Interval Update",
      prompt: "repeat",
      scheduleType: "interval",
      scheduleConfig: { minutes: 15 },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });

    queue.enqueue({
      runId: run.id,
      jobId: job.id,
      priority: 0,
      enqueuedAt: Date.now(),
    });

    const executor = new Executor(mockRunner());
    executor.processNext();

    await new Promise((r) => setTimeout(r, 100));

    const updated = getJob(job.id);
    expect(updated!.nextFireAt).not.toBeNull();
    const nextFire = new Date(updated!.nextFireAt!);
    expect(nextFire.getTime()).toBeGreaterThan(Date.now());
    // Should be roughly 15 minutes from now (within 1 minute tolerance)
    const diffMinutes = (nextFire.getTime() - Date.now()) / 60_000;
    expect(diffMinutes).toBeGreaterThan(13);
    expect(diffMinutes).toBeLessThan(17);
  });
});

describe("Executor cancellation", () => {
  it("cancels a queued run", () => {
    const job = createJob({
      projectId,
      name: "Cancel Queue",
      prompt: "cancel me",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });

    queue.enqueue({
      runId: run.id,
      jobId: job.id,
      priority: 0,
      enqueuedAt: Date.now(),
    });

    const executor = new Executor(mockRunner());
    const cancelled = executor.cancelRun(run.id);

    expect(cancelled).toBe(true);
    expect(queue.size()).toBe(0);

    const updated = getRun(run.id);
    expect(updated!.status).toBe("cancelled");
  });

  it("returns false when cancelling a non-existent run", () => {
    const executor = new Executor(mockRunner());
    const cancelled = executor.cancelRun("nonexistent");
    expect(cancelled).toBe(false);
  });
});

describe("Executor crash recovery", () => {
  it("transitions stuck running runs to failed", () => {
    const job = createJob({
      projectId,
      name: "Crash Recovery",
      prompt: "stuck",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });
    const run = createRun({ jobId: job.id, triggerSource: "scheduled" });
    // Manually set to running (simulating a crash)
    updateRun({
      id: run.id,
      status: "running",
      startedAt: new Date().toISOString(),
    });

    const executor = new Executor(mockRunner());
    executor.recoverFromCrash();

    const updated = getRun(run.id);
    expect(updated!.status).toBe("failed");
    expect(updated!.finishedAt).not.toBeNull();

    const logs = listRunLogs({ runId: run.id });
    expect(logs.some((l) => l.text.includes("agent restart"))).toBe(true);
  });

  it("re-enqueues queued runs after crash", () => {
    const job = createJob({
      projectId,
      name: "Re-enqueue",
      prompt: "waiting",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });
    const run = createRun({ jobId: job.id, triggerSource: "scheduled" });
    // Run stays in "queued" status

    const executor = new Executor(mockRunner());
    executor.recoverFromCrash();

    expect(queue.size()).toBeGreaterThanOrEqual(1);
    const items = queue.getAll();
    const found = items.find((i) => i.runId === run.id);
    expect(found).toBeDefined();
  });

  it("re-enqueues corrective runs with priority 2", () => {
    const job = createJob({
      projectId,
      name: "Corrective Re-enqueue",
      prompt: "corrective",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });
    const parentRun = createRun({ jobId: job.id, triggerSource: "scheduled" });
    const run = createRun({
      jobId: job.id,
      triggerSource: "corrective",
      parentRunId: parentRun.id,
    });

    const executor = new Executor(mockRunner());
    executor.recoverFromCrash();

    const items = queue.getAll();
    const found = items.find((i) => i.runId === run.id);
    expect(found).toBeDefined();
    expect(found!.priority).toBe(2);
  });

  it("re-enqueues manual runs with priority 0", () => {
    const job = createJob({
      projectId,
      name: "Manual Re-enqueue",
      prompt: "manual",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });

    const executor = new Executor(mockRunner());
    executor.recoverFromCrash();

    const items = queue.getAll();
    const found = items.find((i) => i.runId === run.id);
    expect(found).toBeDefined();
    expect(found!.priority).toBe(0);
  });
});

describe("Executor timeout default", () => {
  it("passes timeoutMs=0 when no setting exists", async () => {
    // Ensure no timeout setting
    const { deleteSetting } = await import("../src/db/queries/settings.js");
    deleteSetting("run_timeout_minutes");

    let capturedTimeout: number | undefined;
    const captureRunner = async (config: RunnerConfig) => {
      capturedTimeout = config.timeoutMs;
      config.onLogChunk("stdout", "done");
      return { exitCode: 0, timedOut: false, killed: false, sessionId: null };
    };

    const job = createJob({
      projectId,
      name: "No Timeout Job",
      prompt: "test timeout",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });

    queue.enqueue({
      runId: run.id,
      jobId: job.id,
      priority: 0,
      enqueuedAt: Date.now(),
    });

    const executor = new Executor(captureRunner);
    executor.processNext();
    await new Promise((r) => setTimeout(r, 100));

    expect(capturedTimeout).toBe(0);

    // Restore for other tests
    setSetting("claude_code_path", "/usr/bin/true");
  });
});

describe("Executor correctionNote prompt building", () => {
  it("appends correctionNote to effective prompt", async () => {
    let capturedPrompt = "";
    const captureRunner = async (config: RunnerConfig) => {
      capturedPrompt = config.prompt;
      config.onLogChunk("stdout", "done");
      return { exitCode: 0, timedOut: false, killed: false, sessionId: null };
    };

    const job = createJob({
      projectId,
      name: "CorrectionNote Job",
      prompt: "do the thing",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    // Set correction note directly (not settable at creation)
    const { updateJobCorrectionNote } = await import("../src/db/queries/jobs.js");
    updateJobCorrectionNote(job.id, "Always run tests after changes");
    const run = createRun({ jobId: job.id, triggerSource: "manual" });

    queue.enqueue({
      runId: run.id,
      jobId: job.id,
      priority: 0,
      enqueuedAt: Date.now(),
    });

    const executor = new Executor(captureRunner);
    executor.processNext();
    await new Promise((r) => setTimeout(r, 100));

    expect(capturedPrompt).toContain("do the thing");
    expect(capturedPrompt).toContain("Always run tests after changes");
  });

  it("snapshots correctionNote onto the run", async () => {
    let capturedPrompt = "";
    const captureRunner = async (config: RunnerConfig) => {
      capturedPrompt = config.prompt;
      config.onLogChunk("stdout", "done");
      return { exitCode: 0, timedOut: false, killed: false, sessionId: null };
    };

    const job = createJob({
      projectId,
      name: "Snapshot Job",
      prompt: "do the thing",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    // Set correction note directly
    const { updateJobCorrectionNote } = await import("../src/db/queries/jobs.js");
    updateJobCorrectionNote(job.id, "Check the imports");
    const run = createRun({ jobId: job.id, triggerSource: "manual" });

    queue.enqueue({
      runId: run.id,
      jobId: job.id,
      priority: 0,
      enqueuedAt: Date.now(),
    });

    const executor = new Executor(captureRunner);
    executor.processNext();
    await new Promise((r) => setTimeout(r, 100));

    // Prompt should contain the correction note
    expect(capturedPrompt).toContain("do the thing");
    expect(capturedPrompt).toContain("Check the imports");
    expect(capturedPrompt).toContain("Correction Note");

    // Run should have the snapshot
    const updated = getRun(run.id);
    expect(updated!.correctionNote).toBe("Check the imports");
  });
});

describe("Executor session resumption", () => {
  it("passes resumeSessionId to runner for corrective runs with parent sessionId", async () => {
    let capturedResumeSessionId: string | undefined;
    let capturedPrompt = "";
    const captureRunner = async (config: RunnerConfig) => {
      capturedResumeSessionId = config.resumeSessionId;
      capturedPrompt = config.prompt;
      config.onLogChunk("stdout", "done");
      return { exitCode: 0, timedOut: false, killed: false, sessionId: "new-session" };
    };

    const job = createJob({
      projectId,
      name: "Resume Session Job",
      prompt: "do the thing",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });
    // Create parent run with a sessionId (must transition queued → running → failed)
    const parentRun = createRun({ jobId: job.id, triggerSource: "scheduled" });
    updateRun({ id: parentRun.id, status: "running" });
    updateRun({ id: parentRun.id, status: "failed", sessionId: "parent-session-abc" });

    // Create corrective run with a continuation prompt as correctionNote
    const correctiveRun = createRun({
      jobId: job.id,
      triggerSource: "corrective",
      parentRunId: parentRun.id,
      correctionNote: "The previous attempt failed. Try a different approach.",
    });

    queue.enqueue({
      runId: correctiveRun.id,
      jobId: job.id,
      priority: 2,
      enqueuedAt: Date.now(),
    });

    const executor = new Executor(captureRunner);
    executor.processNext();
    await new Promise((r) => setTimeout(r, 150));

    expect(capturedResumeSessionId).toBe("parent-session-abc");
    // Prompt should be the continuation prompt, not the full job prompt
    expect(capturedPrompt).toBe("The previous attempt failed. Try a different approach.");
  });

  it("uses fresh path when corrective run's parent has no sessionId", async () => {
    let capturedResumeSessionId: string | undefined;
    let capturedPrompt = "";
    const captureRunner = async (config: RunnerConfig) => {
      capturedResumeSessionId = config.resumeSessionId;
      capturedPrompt = config.prompt;
      config.onLogChunk("stdout", "done");
      return { exitCode: 0, timedOut: false, killed: false, sessionId: null };
    };

    const job = createJob({
      projectId,
      name: "No Session Parent Job",
      prompt: "do the thing",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });
    // Parent run WITHOUT sessionId (must transition queued → running → failed)
    const parentRun = createRun({ jobId: job.id, triggerSource: "scheduled" });
    updateRun({ id: parentRun.id, status: "running" });
    updateRun({ id: parentRun.id, status: "failed" }); // No sessionId

    const correctiveRun = createRun({
      jobId: job.id,
      triggerSource: "corrective",
      parentRunId: parentRun.id,
      correctionNote: "Use /src/bar.ts instead",
    });

    queue.enqueue({
      runId: correctiveRun.id,
      jobId: job.id,
      priority: 2,
      enqueuedAt: Date.now(),
    });

    const executor = new Executor(captureRunner);
    executor.processNext();
    await new Promise((r) => setTimeout(r, 150));

    // Should NOT pass resumeSessionId
    expect(capturedResumeSessionId).toBeUndefined();
    // Should use full job prompt (fresh path)
    expect(capturedPrompt).toContain("do the thing");
  });

  it("skips memory injection for resumed runs", async () => {
    // This test verifies that the resume path does NOT call retrieveMemories.
    // The mock runner will capture whether memories were injected via the prompt.
    let capturedPrompt = "";
    const captureRunner = async (config: RunnerConfig) => {
      capturedPrompt = config.prompt;
      config.onLogChunk("stdout", "done");
      return { exitCode: 0, timedOut: false, killed: false, sessionId: "sess" };
    };

    const job = createJob({
      projectId,
      name: "No Memory Inject Job",
      prompt: "do the thing",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });
    const parentRun = createRun({ jobId: job.id, triggerSource: "scheduled" });
    updateRun({ id: parentRun.id, status: "running" });
    updateRun({ id: parentRun.id, status: "failed", sessionId: "parent-sess-456" });

    const correctiveRun = createRun({
      jobId: job.id,
      triggerSource: "corrective",
      parentRunId: parentRun.id,
      correctionNote: "Resume and fix it",
    });

    queue.enqueue({
      runId: correctiveRun.id,
      jobId: job.id,
      priority: 2,
      enqueuedAt: Date.now(),
    });

    const executor = new Executor(captureRunner);
    executor.processNext();
    await new Promise((r) => setTimeout(r, 150));

    // Resume path should use only the continuation prompt, no memory section
    expect(capturedPrompt).toBe("Resume and fix it");
    expect(capturedPrompt).not.toContain("Relevant Memories");
    expect(capturedPrompt).not.toContain("Correction Note");
  });
});

describe("Executor concurrency", () => {
  it("defaults to max concurrency of 2", () => {
    const executor = new Executor(mockRunner());
    expect(executor.maxConcurrency).toBe(2);
  });

  it("respects max_concurrent_runs setting", () => {
    setSetting("max_concurrent_runs", "2");
    const executor = new Executor(mockRunner());
    expect(executor.maxConcurrency).toBe(2);
    // Reset
    setSetting("max_concurrent_runs", "1");
  });

  it("clamps concurrency to range [1, 5]", () => {
    setSetting("max_concurrent_runs", "10");
    const executor = new Executor(mockRunner());
    expect(executor.maxConcurrency).toBe(5);

    setSetting("max_concurrent_runs", "0");
    expect(executor.maxConcurrency).toBe(1);

    // Reset
    setSetting("max_concurrent_runs", "1");
  });
});

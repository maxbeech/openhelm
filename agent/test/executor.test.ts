import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type Mocked } from "vitest";
import { isVenvReady } from "../src/mcp-servers/browser-setup.js";
import { writeMcpConfigFile, BROWSER_MCP_PREAMBLE, BROWSER_CAPTCHA_PREAMBLE } from "../src/mcp-servers/mcp-config-builder.js";
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
import type { ClaudeCodeRunResult } from "@openhelm/shared";

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

// Mock browser MCP modules — default to venv not ready so most tests are unaffected
vi.mock("../src/mcp-servers/browser-setup.js", () => ({
  isVenvReady: vi.fn(() => false),
  isSourceAvailable: vi.fn(() => false),
  setupBrowserMcpVenv: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/mcp-servers/mcp-config-builder.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/mcp-servers/mcp-config-builder.js")>();
  return {
    ...orig,
    writeMcpConfigFile: vi.fn(() => null),
    removeMcpConfigFile: vi.fn(),
    cleanupOrphanedConfigs: vi.fn(),
  };
});

// Mock LLM-dependent modules (avoid real Claude Code CLI calls)
vi.mock("../src/planner/failure-analyzer.js", () => ({
  analyzeFailure: vi.fn().mockResolvedValue(null),
}));

vi.mock("../src/planner/summarize.js", () => ({
  generateRunSummary: vi.fn().mockResolvedValue(null),
  collectRunLogs: vi.fn().mockReturnValue(""),
  truncateLogsForAnalysis: vi.fn().mockReturnValue(""),
  truncateLogs: vi.fn().mockReturnValue(""),
}));

vi.mock("../src/planner/correction-evaluator.js", () => ({
  evaluateCorrectionNote: vi.fn().mockResolvedValue(null),
}));

vi.mock("../src/planner/outcome-assessor.js", () => ({
  assessOutcome: vi.fn().mockResolvedValue(null),
}));

// Mock memory extraction — not under test here
vi.mock("../src/memory/run-extractor.js", () => ({
  extractMemoriesFromRun: vi.fn().mockResolvedValue(undefined),
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

    // Poll until the run reaches a terminal state (cold dynamic imports on first call can
    // take >100ms; polling is more robust than a fixed timeout)
    const deadline = Date.now() + 3000;
    let updated = getRun(run.id);
    while ((updated?.status === "running" || updated?.status === "queued") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      updated = getRun(run.id);
    }

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
    // and creates a dashboard item instead
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

  it("escalates corrective run failure to permanent_failure with dashboard item", async () => {
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

    // Verify dashboard.created was emitted
    const dashboardEmits = mockEmit.mock.calls.filter((c) => c[0] === "dashboard.created");
    expect(dashboardEmits).toHaveLength(1);
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

describe("Executor global prompt injection", () => {
  it("appends global_prompt setting to effective prompt", async () => {
    let capturedPrompt = "";
    const captureRunner = async (config: RunnerConfig) => {
      capturedPrompt = config.prompt;
      config.onLogChunk("stdout", "done");
      return { exitCode: 0, timedOut: false, killed: false, sessionId: null };
    };

    setSetting("global_prompt", "Always write tests.");

    const job = createJob({
      projectId,
      name: "Global Prompt Job",
      prompt: "do the thing",
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

    const executor = new Executor(captureRunner);
    executor.processNext();
    await new Promise((r) => setTimeout(r, 150));

    expect(capturedPrompt).toContain("do the thing");
    expect(capturedPrompt).toContain("Always write tests.");

    // Clean up
    setSetting("global_prompt", "");
  });

  it("does not append global_prompt when setting is empty", async () => {
    let capturedPrompt = "";
    const captureRunner = async (config: RunnerConfig) => {
      capturedPrompt = config.prompt;
      config.onLogChunk("stdout", "done");
      return { exitCode: 0, timedOut: false, killed: false, sessionId: null };
    };

    setSetting("global_prompt", "");

    const job = createJob({
      projectId,
      name: "No Global Prompt Job",
      prompt: "do the thing",
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

    const executor = new Executor(captureRunner);
    executor.processNext();
    await new Promise((r) => setTimeout(r, 150));

    expect(capturedPrompt).toBe("do the thing");
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

describe("Focus guard PID lifecycle", () => {
  it("emits focus_guard.addPid when runner reports PID and focus_guard.removePid after completion", async () => {
    const { emit } = await import("../src/ipc/emitter.js");
    const mockEmit = vi.mocked(emit);
    mockEmit.mockClear();

    const FAKE_PID = 99999;

    // Mock runner that fires onPidAvailable before returning
    const runnerWithPid = async (
      config: RunnerConfig,
    ): Promise<ClaudeCodeRunResult> => {
      config.onPidAvailable?.(FAKE_PID);
      config.onLogChunk("stdout", "some output");
      return { exitCode: 0, timedOut: false, killed: false };
    };

    const job = createJob({
      projectId,
      name: "Focus Guard Job",
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

    const executor = new Executor(runnerWithPid);
    executor.processNext();

    await new Promise((r) => setTimeout(r, 200));

    const addPidCall = mockEmit.mock.calls.find(
      ([event]) => event === "focus_guard.addPid",
    );
    expect(addPidCall).toBeDefined();
    expect((addPidCall![1] as { pid: number }).pid).toBe(FAKE_PID);

    const removePidCall = mockEmit.mock.calls.find(
      ([event]) => event === "focus_guard.removePid",
    );
    expect(removePidCall).toBeDefined();
    expect((removePidCall![1] as { pid: number }).pid).toBe(FAKE_PID);
  });

  it("does not emit focus_guard events when runner does not provide a PID", async () => {
    const { emit } = await import("../src/ipc/emitter.js");
    const mockEmit = vi.mocked(emit);
    mockEmit.mockClear();

    // Mock runner that never fires onPidAvailable
    const runnerNoPid = async (
      config: RunnerConfig,
    ): Promise<ClaudeCodeRunResult> => {
      config.onLogChunk("stdout", "some output");
      return { exitCode: 0, timedOut: false, killed: false };
    };

    const job = createJob({
      projectId,
      name: "No PID Job",
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

    const executor = new Executor(runnerNoPid);
    executor.processNext();

    await new Promise((r) => setTimeout(r, 200));

    const focusGuardCalls = mockEmit.mock.calls.filter(([event]) =>
      (event as string).startsWith("focus_guard."),
    );
    expect(focusGuardCalls).toHaveLength(0);
  });
});

describe("Executor stuck-run protection", () => {
  it("marks run as failed and releases the slot when the runner throws unexpectedly", async () => {
    // Runner that throws immediately — simulates an unexpected bug mid-execution
    const throwingRunner = async (_config: RunnerConfig): Promise<ClaudeCodeRunResult> => {
      throw new Error("Unexpected runner crash");
    };

    const job = createJob({
      projectId,
      name: "Throwing Runner Job",
      prompt: "do something",
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

    const executor = new Executor(throwingRunner);
    executor.processNext();

    await new Promise((r) => setTimeout(r, 150));

    // Run must not be left stuck in "running"
    const updated = getRun(run.id);
    expect(updated!.status).toBe("failed");

    // Active-run slot must be released so the executor can continue
    expect(executor.activeRunCount).toBe(0);

    // A log entry must be written so the user can see what happened
    const logs = listRunLogs({ runId: run.id });
    expect(logs.some((l) => l.text.includes("internal executor error"))).toBe(true);
  });
});

describe("Executor browser MCP preamble", () => {
  const mockIsVenvReady = vi.mocked(isVenvReady);
  const mockWriteMcpConfigFile = vi.mocked(writeMcpConfigFile);

  beforeEach(() => {
    mockIsVenvReady.mockReturnValue(false);
    mockWriteMcpConfigFile.mockReturnValue(null);
  });

  it("prepends browser MCP preamble when venv is ready", async () => {
    mockIsVenvReady.mockReturnValue(true);
    // Use a real temp file — the executor pre-flights the config path with
    // fsExists() after writeMcpConfigFile returns (Phase 6 hardening).
    const { writeFileSync, mkdtempSync } = await import("fs");
    const { join: pathJoin } = await import("path");
    const { tmpdir } = await import("os");
    const tmpDir = mkdtempSync(pathJoin(tmpdir(), "oh-mcp-config-"));
    const tmpConfigPath = pathJoin(tmpDir, "run-test.json");
    writeFileSync(tmpConfigPath, "{}");
    mockWriteMcpConfigFile.mockReturnValue(tmpConfigPath);

    let capturedPrompt = "";
    const captureRunner = async (config: RunnerConfig) => {
      capturedPrompt = config.prompt;
      config.onLogChunk("stdout", "done");
      return { exitCode: 0, timedOut: false, killed: false, sessionId: null };
    };

    const job = createJob({
      projectId,
      name: "Browser Preamble Job",
      prompt: "navigate to example.com",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    queue.enqueue({ runId: run.id, jobId: job.id, priority: 0, enqueuedAt: Date.now() });

    const executor = new Executor(captureRunner);
    executor.processNext();
    await new Promise((r) => setTimeout(r, 100));

    expect(capturedPrompt).toContain(BROWSER_MCP_PREAMBLE);
    expect(capturedPrompt).toContain(BROWSER_CAPTCHA_PREAMBLE);
    expect(capturedPrompt).toContain("navigate to example.com");
    // Browser credentials notice is now always prepended (even when empty),
    // so the prompt no longer starts with BROWSER_MCP_PREAMBLE.
    expect(capturedPrompt).toContain("BROWSER CREDENTIALS:");
  });

  it("does not prepend preamble when venv is not ready", async () => {
    mockIsVenvReady.mockReturnValue(false);
    mockWriteMcpConfigFile.mockReturnValue(null);

    let capturedPrompt = "";
    const captureRunner = async (config: RunnerConfig) => {
      capturedPrompt = config.prompt;
      config.onLogChunk("stdout", "done");
      return { exitCode: 0, timedOut: false, killed: false, sessionId: null };
    };

    const job = createJob({
      projectId,
      name: "No Preamble Job",
      prompt: "navigate to example.com",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    queue.enqueue({ runId: run.id, jobId: job.id, priority: 0, enqueuedAt: Date.now() });

    const executor = new Executor(captureRunner);
    executor.processNext();
    await new Promise((r) => setTimeout(r, 100));

    expect(capturedPrompt).not.toContain(BROWSER_MCP_PREAMBLE);
    expect(capturedPrompt).not.toContain(BROWSER_CAPTCHA_PREAMBLE);
    expect(capturedPrompt).toBe("navigate to example.com");
  });
});

describe("Outcome assessment", () => {
  it("keeps succeeded when assessOutcome returns null (LLM error)", async () => {
    const { assessOutcome } = await import("../src/planner/outcome-assessor.js");
    (assessOutcome as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const job = createJob({
      projectId,
      name: "Null Assessment Job",
      prompt: "do something",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    queue.enqueue({ runId: run.id, jobId: job.id, priority: 0, enqueuedAt: Date.now() });

    const executor = new Executor(mockRunner({ exitCode: 0, timedOut: false, killed: false }));
    executor.processNext();

    const deadline = Date.now() + 3000;
    let updated = getRun(run.id);
    while ((updated?.status === "running" || updated?.status === "queued") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      updated = getRun(run.id);
    }

    expect(updated!.status).toBe("succeeded");
  });

  it("flips to failed when mission not accomplished with high confidence", async () => {
    const { assessOutcome } = await import("../src/planner/outcome-assessor.js");
    (assessOutcome as ReturnType<typeof vi.fn>).mockResolvedValue({
      accomplished: false,
      confidence: "high",
      reason: "Login failed due to anti-bot block",
    });

    const job = createJob({
      projectId,
      name: "Failed Mission Job",
      prompt: "log in and post",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    queue.enqueue({ runId: run.id, jobId: job.id, priority: 0, enqueuedAt: Date.now() });

    const executor = new Executor(mockRunner({ exitCode: 0, timedOut: false, killed: false }));
    executor.processNext();

    const deadline = Date.now() + 3000;
    let updated = getRun(run.id);
    while ((updated?.status === "running" || updated?.status === "queued") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      updated = getRun(run.id);
    }

    expect(updated!.status).toBe("failed");
    expect(updated!.exitCode).toBe(0);

    // Verify a log entry was created with the assessment reason
    const logs = listRunLogs({ runId: run.id });
    const assessmentLog = logs.find((l) => l.text.includes("Mission not accomplished"));
    expect(assessmentLog).toBeDefined();
    expect(assessmentLog!.stream).toBe("stderr");
  });

  it("keeps succeeded when confidence is low", async () => {
    const { assessOutcome } = await import("../src/planner/outcome-assessor.js");
    (assessOutcome as ReturnType<typeof vi.fn>).mockResolvedValue({
      accomplished: false,
      confidence: "low",
      reason: "Ambiguous outcome",
    });

    const job = createJob({
      projectId,
      name: "Low Confidence Job",
      prompt: "check something",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    queue.enqueue({ runId: run.id, jobId: job.id, priority: 0, enqueuedAt: Date.now() });

    const executor = new Executor(mockRunner({ exitCode: 0, timedOut: false, killed: false }));
    executor.processNext();

    const deadline = Date.now() + 3000;
    let updated = getRun(run.id);
    while ((updated?.status === "running" || updated?.status === "queued") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      updated = getRun(run.id);
    }

    expect(updated!.status).toBe("succeeded");
  });

  it("keeps succeeded when mission is accomplished", async () => {
    const { assessOutcome } = await import("../src/planner/outcome-assessor.js");
    (assessOutcome as ReturnType<typeof vi.fn>).mockResolvedValue({
      accomplished: true,
      confidence: "high",
      reason: "All tasks completed successfully",
    });

    const job = createJob({
      projectId,
      name: "Accomplished Job",
      prompt: "do the thing",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    queue.enqueue({ runId: run.id, jobId: job.id, priority: 0, enqueuedAt: Date.now() });

    const executor = new Executor(mockRunner({ exitCode: 0, timedOut: false, killed: false }));
    executor.processNext();

    const deadline = Date.now() + 3000;
    let updated = getRun(run.id);
    while ((updated?.status === "running" || updated?.status === "queued") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      updated = getRun(run.id);
    }

    expect(updated!.status).toBe("succeeded");
  });
});

describe("Executor MCP tool-missing auto-retry", () => {
  /**
   * Round 6 fix (2026-04-10): when a run fails because Claude Code reported
   * "No such tool available: mcp__..." — i.e. an MCP server (usually the
   * Python browser MCP) failed to register its tools in time — we auto-retry
   * the run exactly once by enqueuing a fresh manual run with parentRunId set.
   * LLM-driven self-correction is bypassed because it cannot help here (the
   * session has no tools to work with).
   */

  /** Runner that writes the MCP tool-missing string to stdout then exits 0. */
  function mockMcpMissingRunner(): (
    config: RunnerConfig,
    signal?: AbortSignal,
  ) => Promise<ClaudeCodeRunResult> {
    return async (config) => {
      config.onLogChunk(
        "stdout",
        "Error: No such tool available: mcp__openhelm_browser__spawn_browser",
      );
      return { exitCode: 0, timedOut: false, killed: false };
    };
  }

  it("enqueues a fresh retry when Claude reports 'No such tool available: mcp__'", async () => {
    const job = createJob({
      projectId,
      name: "MCP Flake Job",
      prompt: "spawn a browser",
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

    const executor = new Executor(mockMcpMissingRunner());
    executor.processNext();

    // Wait for the failure + retry enqueue path
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const updated = getRun(run.id);
      if (updated?.status === "failed" || updated?.status === "succeeded") break;
      await new Promise((r) => setTimeout(r, 20));
    }

    // The parent run is failed
    const parent = getRun(run.id);
    expect(parent!.status).toBe("failed");

    // A retry run was created referencing the failed run as parent
    const retries = listRuns({ jobId: job.id }).filter(
      (r) => r.parentRunId === run.id,
    );
    expect(retries).toHaveLength(1);
    expect(retries[0].triggerSource).toBe("manual");
    // The retry has an informative breadcrumb stderr log
    const retryLogs = listRunLogs({ runId: retries[0].id });
    const breadcrumb = retryLogs.find((l) =>
      l.text.includes("did not register its tools in time"),
    );
    expect(breadcrumb).toBeDefined();
  });

  it("force-runs the retry even when scheduler_paused is true", async () => {
    // This is the regression test for Run d92edd14: the first fix enqueued
    // the retry correctly but processNext() short-circuits on scheduler_paused,
    // so the retry got stuck in "queued" forever. The fix uses forceRun to
    // bypass the pause guard, matching the "Run Now Anyway" button.
    setSetting("scheduler_paused", "true");
    try {
      const job = createJob({
        projectId,
        name: "MCP Flake Under Pause",
        prompt: "spawn a browser",
        scheduleType: "once",
        scheduleConfig: { fireAt: new Date().toISOString() },
      });

      // First call: MCP flake (stdout contains 'No such tool available').
      // Second call (the retry): succeeds cleanly.
      let callCount = 0;
      const flakyThenSuccess = async (
        config: RunnerConfig,
      ): Promise<ClaudeCodeRunResult> => {
        callCount++;
        if (callCount === 1) {
          config.onLogChunk(
            "stdout",
            "Error: No such tool available: mcp__openhelm_browser__spawn_browser",
          );
          return { exitCode: 0, timedOut: false, killed: false };
        }
        config.onLogChunk("stdout", "retry success");
        return { exitCode: 0, timedOut: false, killed: false };
      };

      const run = createRun({ jobId: job.id, triggerSource: "manual" });
      queue.enqueue({
        runId: run.id,
        jobId: job.id,
        priority: 0,
        enqueuedAt: Date.now(),
      });

      const executor = new Executor(flakyThenSuccess);
      // forceRun bypasses the scheduler pause, so the ORIGINAL run still
      // needs to get started somehow with the pause on. Use forceRun here too.
      executor.forceRun(run.id);

      // Wait until both runs complete (original fails, retry succeeds)
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const retries = listRuns({ jobId: job.id }).filter(
          (r) => r.parentRunId === run.id,
        );
        if (retries.length === 1 && retries[0].status === "succeeded") break;
        await new Promise((r) => setTimeout(r, 30));
      }

      // Both runs should have been executed — callCount === 2 proves the
      // retry actually ran, not just got enqueued.
      expect(callCount).toBe(2);
      const parent = getRun(run.id);
      expect(parent!.status).toBe("failed");
      const retries = listRuns({ jobId: job.id }).filter(
        (r) => r.parentRunId === run.id,
      );
      expect(retries).toHaveLength(1);
      expect(retries[0].status).toBe("succeeded");
    } finally {
      // Clean up the paused flag so it doesn't leak into other tests
      setSetting("scheduler_paused", "false");
    }
  });

  it("does NOT retry again if the failing run is itself an MCP retry", async () => {
    const job = createJob({
      projectId,
      name: "MCP Loop Guard Job",
      prompt: "spawn a browser",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    // Original run (doesn't need to be in a terminal state for this test —
    // we only care that a retry run with parentRunId is processed and does
    // not spawn a grandchild retry)
    const parent = createRun({ jobId: job.id, triggerSource: "manual" });
    // Retry run (has parentRunId) — this is what's running now and will fail
    const retry = createRun({
      jobId: job.id,
      triggerSource: "manual",
      parentRunId: parent.id,
    });

    queue.enqueue({
      runId: retry.id,
      jobId: job.id,
      priority: 0,
      enqueuedAt: Date.now(),
    });

    const executor = new Executor(mockMcpMissingRunner());
    executor.processNext();

    // Wait for the retry to fail
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const updated = getRun(retry.id);
      if (updated?.status === "failed" || updated?.status === "succeeded") break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const finalRetry = getRun(retry.id);
    expect(finalRetry!.status).toBe("failed");

    // Exactly one run has retry.id as parent would be a loop — assert zero.
    const grandchildren = listRuns({ jobId: job.id }).filter(
      (r) => r.parentRunId === retry.id,
    );
    expect(grandchildren).toHaveLength(0);
  });
});

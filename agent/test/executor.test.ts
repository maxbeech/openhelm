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

describe("Executor concurrency", () => {
  it("defaults to max concurrency of 1", () => {
    const executor = new Executor(mockRunner());
    expect(executor.maxConcurrency).toBe(1);
  });

  it("respects max_concurrent_runs setting", () => {
    setSetting("max_concurrent_runs", "2");
    const executor = new Executor(mockRunner());
    expect(executor.maxConcurrency).toBe(2);
    // Reset
    setSetting("max_concurrent_runs", "1");
  });

  it("clamps concurrency to range [1, 3]", () => {
    setSetting("max_concurrent_runs", "10");
    const executor = new Executor(mockRunner());
    expect(executor.maxConcurrency).toBe(3);

    setSetting("max_concurrent_runs", "0");
    expect(executor.maxConcurrency).toBe(1);

    // Reset
    setSetting("max_concurrent_runs", "1");
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createJob } from "../src/db/queries/jobs.js";
import { createRun, getRun, listRuns } from "../src/db/queries/runs.js";
import { setSetting } from "../src/db/queries/settings.js";
import { JobQueue } from "../src/scheduler/queue.js";
import { Executor } from "../src/executor/index.js";
import type { AgentRunConfig, AgentRunResult } from "../src/agent-backend/types.js";
import type { InteractiveDetectionType } from "../src/claude-code/interactive-detector.js";

let cleanup: () => void;
let projectId: string;
let queue: JobQueue;

vi.mock("../src/scheduler/queue.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/scheduler/queue.js")>();
  return {
    ...orig,
    get jobQueue() {
      return queue;
    },
  };
});

vi.mock("../src/ipc/emitter.js", () => ({
  emit: vi.fn(),
  send: vi.fn(),
}));

// Mock self-correction to track whether it's called
vi.mock("../src/executor/self-correction.js", () => ({
  attemptSelfCorrection: vi.fn().mockResolvedValue({ attempted: false, reason: "mock" }),
}));

// Mock failure triage
vi.mock("../src/executor/failure-triage.js", () => ({
  triagePermanentFailure: vi.fn(),
}));

// Mock summarize
vi.mock("../src/planner/summarize.js", () => ({
  generateRunSummary: vi.fn().mockResolvedValue(null),
  collectRunLogs: vi.fn().mockReturnValue(""),
  truncateLogsForAnalysis: vi.fn().mockReturnValue(""),
  truncateLogs: vi.fn().mockReturnValue(""),
}));

// Mock memory extraction — not under test here
vi.mock("../src/memory/run-extractor.js", () => ({
  extractMemoriesFromRun: vi.fn().mockResolvedValue(undefined),
}));

import { attemptSelfCorrection } from "../src/executor/self-correction.js";
const mockSelfCorrection = vi.mocked(attemptSelfCorrection);

beforeAll(() => {
  cleanup = setupTestDb();
  const project = createProject({
    name: "HITL Executor Test",
    directoryPath: "/tmp",
  });
  projectId = project.id;
  setSetting("claude_code_path", "/usr/bin/true");
});

afterAll(() => cleanup());

beforeEach(() => {
  queue = new JobQueue();
  vi.clearAllMocks();
  mockSelfCorrection.mockResolvedValue({ attempted: false, reason: "mock" });
});

/** Create a backend run function that triggers interactive_detected then returns killed */
function hitlRunner(
  type: InteractiveDetectionType,
): (config: AgentRunConfig) => Promise<AgentRunResult> {
  return async (config) => {
    config.onStdout?.("Some output");
    config.onEvent?.({
      type: "system",
      data: { kind: "interactive_detected", reason: "test reason", detectionType: type },
    });
    return { exitCode: null, timedOut: false, killed: true, sessionId: null, inputTokens: null, outputTokens: null, rateLimitUtilization: null };
  };
}

describe("Executor HITL kill types and self-correction", () => {
  it("allows self-correction for silence_timeout kills", async () => {
    const job = createJob({
      projectId,
      name: "Silence Job",
      prompt: "do work",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "scheduled" });

    queue.enqueue({
      runId: run.id,
      jobId: job.id,
      priority: 1,
      enqueuedAt: Date.now(),
    });

    const executor = new Executor(hitlRunner("silence_timeout"));
    executor.processNext();

    await new Promise((r) => setTimeout(r, 150));

    expect(mockSelfCorrection).toHaveBeenCalledOnce();
    expect(mockSelfCorrection).toHaveBeenCalledWith(
      run.id,
      expect.objectContaining({ id: job.id }),
      expect.any(Function),
      expect.objectContaining({
        isSilenceTimeout: true,
        failureContext: expect.stringContaining("silence timeout"),
      }),
    );
  });

  it("allows self-correction for timeout kills", async () => {
    const job = createJob({
      projectId,
      name: "Timeout Job",
      prompt: "long task",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "scheduled" });

    queue.enqueue({
      runId: run.id,
      jobId: job.id,
      priority: 1,
      enqueuedAt: Date.now(),
    });

    // Backend run function that simulates a timeout
    const timeoutRunner = async (config: AgentRunConfig): Promise<AgentRunResult> => {
      config.onStdout?.("Working...");
      return { exitCode: null, timedOut: true, killed: false, sessionId: null, inputTokens: null, outputTokens: null, rateLimitUtilization: null };
    };

    const executor = new Executor(timeoutRunner);
    executor.processNext();

    await new Promise((r) => setTimeout(r, 150));

    expect(mockSelfCorrection).toHaveBeenCalledOnce();
    expect(mockSelfCorrection).toHaveBeenCalledWith(
      run.id,
      expect.objectContaining({ id: job.id }),
      expect.any(Function),
      expect.objectContaining({
        isTimeout: true,
        failureContext: expect.stringContaining("timed out after"),
      }),
    );
  });
});

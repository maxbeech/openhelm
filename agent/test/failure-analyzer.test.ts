import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createJob } from "../src/db/queries/jobs.js";
import { createRun } from "../src/db/queries/runs.js";
import { createRunLog } from "../src/db/queries/run-logs.js";
import { setSetting } from "../src/db/queries/settings.js";

// Mock the LLM call
vi.mock("../src/planner/llm-via-cli.js", () => ({
  callLlmViaCli: vi.fn(),
}));

import { callLlmViaCli } from "../src/planner/llm-via-cli.js";
import { analyzeFailure } from "../src/planner/failure-analyzer.js";

const mockLlm = vi.mocked(callLlmViaCli);

let cleanup: () => void;
let projectId: string;

beforeAll(() => {
  cleanup = setupTestDb();
  const project = createProject({
    name: "Analyzer Test",
    directoryPath: "/tmp",
  });
  projectId = project.id;
  setSetting("claude_code_path", "/usr/bin/true");
});

afterAll(() => cleanup());

describe("analyzeFailure", () => {
  it("returns fixable analysis when LLM says fixable", async () => {
    const job = createJob({
      projectId,
      name: "Fix Job",
      prompt: "fix the bug",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    createRunLog({ runId: run.id, stream: "stderr", text: "Error: file not found /src/foo.ts" });

    mockLlm.mockResolvedValueOnce({ text: JSON.stringify({
      fixable: true,
      correction: "The file is at /src/bar.ts, not /src/foo.ts. Use the correct path.",
      reason: "Wrong file path referenced",
    }), sessionId: null });

    const result = await analyzeFailure(run.id, job.prompt);

    expect(result).not.toBeNull();
    expect(result!.fixable).toBe(true);
    expect(result!.correction).toContain("/src/bar.ts");
    expect(result!.reason).toBe("Wrong file path referenced");
  });

  it("returns not-fixable analysis for infrastructure failures", async () => {
    const job = createJob({
      projectId,
      name: "Infra Job",
      prompt: "deploy",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    createRunLog({ runId: run.id, stream: "stderr", text: "ECONNREFUSED" });

    mockLlm.mockResolvedValueOnce({ text: JSON.stringify({
      fixable: false,
      correction: null,
      reason: "Network connectivity issue — infrastructure problem",
    }), sessionId: null });

    const result = await analyzeFailure(run.id, job.prompt);

    expect(result).not.toBeNull();
    expect(result!.fixable).toBe(false);
    expect(result!.correction).toBeNull();
  });

  it("returns null when LLM call fails", async () => {
    const job = createJob({
      projectId,
      name: "LLM Fail Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    createRunLog({ runId: run.id, stream: "stderr", text: "some error" });

    mockLlm.mockRejectedValueOnce(new Error("CLI timeout"));

    const result = await analyzeFailure(run.id, job.prompt);
    expect(result).toBeNull();
  });

  it("returns null when LLM returns invalid JSON", async () => {
    const job = createJob({
      projectId,
      name: "Bad JSON Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    createRunLog({ runId: run.id, stream: "stderr", text: "some error" });

    mockLlm.mockResolvedValueOnce({ text: "not valid json at all", sessionId: null });

    const result = await analyzeFailure(run.id, job.prompt);
    expect(result).toBeNull();
  });

  it("includes failureContext in LLM user message when provided", async () => {
    const job = createJob({
      projectId,
      name: "Context Job",
      prompt: "run the task",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    createRunLog({ runId: run.id, stream: "stderr", text: "timed out waiting" });

    mockLlm.mockResolvedValueOnce({ text: JSON.stringify({
      fixable: true,
      correction: "Try a different approach",
      reason: "Silence timeout — got stuck",
    }), sessionId: null });

    await analyzeFailure(run.id, job.prompt, "The run was killed due to silence timeout.");

    const lastCall = mockLlm.mock.calls[mockLlm.mock.calls.length - 1][0];
    expect(lastCall.userMessage).toContain("Failure context:");
    expect(lastCall.userMessage).toContain("silence timeout");
  });

  it("omits failureContext from user message when not provided", async () => {
    const job = createJob({
      projectId,
      name: "No Context Job",
      prompt: "run the task",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    createRunLog({ runId: run.id, stream: "stderr", text: "some error" });

    mockLlm.mockResolvedValueOnce({ text: JSON.stringify({
      fixable: false,
      correction: null,
      reason: "Unknown error",
    }), sessionId: null });

    await analyzeFailure(run.id, job.prompt);

    const lastCall = mockLlm.mock.calls[mockLlm.mock.calls.length - 1][0];
    expect(lastCall.userMessage).not.toContain("Failure context:");
  });

  it("returns not-fixable when run has no logs", async () => {
    const job = createJob({
      projectId,
      name: "No Logs Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });

    const result = await analyzeFailure(run.id, job.prompt);

    expect(result).not.toBeNull();
    expect(result!.fixable).toBe(false);
    expect(result!.reason).toContain("No output");
  });
});

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createJob } from "../src/db/queries/jobs.js";
import { createRun } from "../src/db/queries/runs.js";
import { createRunLog } from "../src/db/queries/run-logs.js";

// Mock the LLM via CLI adapter
const callLlmViaCliMock = vi.fn();
vi.mock("../src/planner/llm-via-cli.js", () => ({
  callLlmViaCli: (...args: unknown[]) => callLlmViaCliMock(...args),
}));

import {
  truncateLogs,
  collectRunLogs,
  generateRunSummary,
} from "../src/planner/summarize.js";

let cleanup: () => void;
let projectId: string;

beforeAll(() => {
  cleanup = setupTestDb();
  const project = createProject({ name: "Summary Test", directoryPath: "/tmp" });
  projectId = project.id;
});

afterAll(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
});

describe("truncateLogs", () => {
  it("returns short text unchanged", () => {
    const text = "Hello world";
    expect(truncateLogs(text)).toBe(text);
  });

  it("returns text at exactly the limit unchanged", () => {
    const text = "x".repeat(8_000);
    expect(truncateLogs(text)).toBe(text);
  });

  it("truncates long text from the beginning, keeping the end", () => {
    const text = "A".repeat(5_000) + "B".repeat(5_000);
    const result = truncateLogs(text);

    // Should start with the truncation notice
    expect(result).toContain("[Earlier output was truncated");
    // Should end with the last 8000 chars of the original
    expect(result.endsWith("B".repeat(5_000))).toBe(true);
    // Should NOT contain the beginning As (beyond what fits in 8000)
    const bodyAfterNotice = result.slice(result.indexOf("\n") + 1);
    expect(bodyAfterNotice.length).toBe(8_000);
  });
});

describe("collectRunLogs", () => {
  it("concatenates all log chunks for a run in sequence order", () => {
    const job = createJob({
      projectId,
      name: "Log Collect Job",
      prompt: "test",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });

    createRunLog({ runId: run.id, stream: "stdout", text: "line 1\n" });
    createRunLog({ runId: run.id, stream: "stdout", text: "line 2\n" });
    createRunLog({ runId: run.id, stream: "stderr", text: "error\n" });

    const result = collectRunLogs(run.id);
    expect(result).toBe("line 1\nline 2\nerror\n");
  });

  it("returns empty string for a run with no logs", () => {
    const job = createJob({
      projectId,
      name: "No Logs Job",
      prompt: "test",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });

    expect(collectRunLogs(run.id)).toBe("");
  });
});

describe("generateRunSummary", () => {
  it("returns a summary from the LLM for a succeeded run", async () => {
    const job = createJob({
      projectId,
      name: "Summary Success",
      prompt: "test",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    createRunLog({ runId: run.id, stream: "stdout", text: "All tests passed." });

    callLlmViaCliMock.mockResolvedValueOnce(
      { text: "The run completed successfully. All tests passed without errors.", sessionId: null },
    );

    const summary = await generateRunSummary(run.id, "succeeded");
    expect(summary).toBe("The run completed successfully. All tests passed without errors.");

    // Verify call was made with classification model
    expect(callLlmViaCliMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "classification",
      }),
    );
  });

  it("returns a summary for a failed run", async () => {
    const job = createJob({
      projectId,
      name: "Summary Fail",
      prompt: "test",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    createRunLog({ runId: run.id, stream: "stderr", text: "Error: module not found" });

    callLlmViaCliMock.mockResolvedValueOnce(
      { text: "The run failed due to a missing module dependency.", sessionId: null },
    );

    const summary = await generateRunSummary(run.id, "failed");
    expect(summary).toBe("The run failed due to a missing module dependency.");
  });

  it("returns a fallback message when there are no logs (succeeded)", async () => {
    const job = createJob({
      projectId,
      name: "No Logs Success",
      prompt: "test",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });

    const summary = await generateRunSummary(run.id, "succeeded");
    expect(summary).toBe("Run completed successfully with no output.");
    expect(callLlmViaCliMock).not.toHaveBeenCalled();
  });

  it("returns a fallback message when there are no logs (failed)", async () => {
    const job = createJob({
      projectId,
      name: "No Logs Fail",
      prompt: "test",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });

    const summary = await generateRunSummary(run.id, "failed");
    expect(summary).toBe("Run ended with no output captured.");
    expect(callLlmViaCliMock).not.toHaveBeenCalled();
  });

  it("returns null when LLM call fails", async () => {
    const job = createJob({
      projectId,
      name: "LLM Fail",
      prompt: "test",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    createRunLog({ runId: run.id, stream: "stdout", text: "some output" });

    callLlmViaCliMock.mockRejectedValueOnce(new Error("CLI unavailable"));

    const summary = await generateRunSummary(run.id, "succeeded");
    expect(summary).toBeNull();
  });

  it("returns null when LLM returns empty content", async () => {
    const job = createJob({
      projectId,
      name: "Empty LLM",
      prompt: "test",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    createRunLog({ runId: run.id, stream: "stdout", text: "output" });

    callLlmViaCliMock.mockResolvedValueOnce({ text: "", sessionId: null });

    const summary = await generateRunSummary(run.id, "succeeded");
    expect(summary).toBeNull();
  });

  it("includes run status in the LLM prompt", async () => {
    const job = createJob({
      projectId,
      name: "Status Check",
      prompt: "test",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    createRunLog({ runId: run.id, stream: "stdout", text: "done" });

    callLlmViaCliMock.mockResolvedValueOnce({ text: "Summary.", sessionId: null });

    await generateRunSummary(run.id, "cancelled");

    const callArgs = callLlmViaCliMock.mock.calls[0][0];
    expect(callArgs.userMessage).toContain("Run status: cancelled");
    expect(callArgs.userMessage).toContain("done");
  });

  it("truncates long logs before sending to LLM", async () => {
    const job = createJob({
      projectId,
      name: "Long Logs",
      prompt: "test",
      scheduleType: "once",
      scheduleConfig: { fireAt: new Date().toISOString() },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });

    // Create a log chunk larger than 8000 chars
    const longText = "x".repeat(12_000);
    createRunLog({ runId: run.id, stream: "stdout", text: longText });

    callLlmViaCliMock.mockResolvedValueOnce({ text: "Summary of long output.", sessionId: null });

    await generateRunSummary(run.id, "succeeded");

    const callArgs = callLlmViaCliMock.mock.calls[0][0];
    expect(callArgs.userMessage).toContain("[Earlier output was truncated");
    // The message should not contain the full 12000 chars
    expect(callArgs.userMessage.length).toBeLessThan(12_000);
  });
});

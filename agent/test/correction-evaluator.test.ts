import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createJob } from "../src/db/queries/jobs.js";
import { createRun } from "../src/db/queries/runs.js";
import { createRunLog } from "../src/db/queries/run-logs.js";

// Mock LLM via CLI
vi.mock("../src/planner/llm-via-cli.js", () => ({
  callLlmViaCli: vi.fn(),
}));

import { callLlmViaCli } from "../src/planner/llm-via-cli.js";
import { evaluateCorrectionNote } from "../src/planner/correction-evaluator.js";

const mockCallLlm = vi.mocked(callLlmViaCli);

let cleanup: () => void;
let projectId: string;

beforeAll(() => {
  cleanup = setupTestDb();
  const project = createProject({
    name: "Correction Evaluator Test",
    directoryPath: "/tmp",
  });
  projectId = project.id;
});

afterAll(() => cleanup());

function makeRunWithLogs(): string {
  const job = createJob({
    projectId,
    name: `Eval Job ${Math.random()}`,
    prompt: "fix the bug",
    scheduleType: "manual",
    scheduleConfig: {},
  });
  const run = createRun({ jobId: job.id, triggerSource: "manual" });
  createRunLog({ runId: run.id, stream: "stdout", text: "All tests passed." });
  return run.id;
}

describe("evaluateCorrectionNote", () => {
  it("returns 'remove' when LLM says issue is resolved", async () => {
    const runId = makeRunWithLogs();
    mockCallLlm.mockResolvedValueOnce({ text:
      JSON.stringify({ action: "remove", reason: "Issue fully resolved" }), sessionId: null,
    });

    const result = await evaluateCorrectionNote(runId, "fix the bug", "Use correct path");

    expect(result).not.toBeNull();
    expect(result!.action).toBe("remove");
    expect(result!.reason).toBe("Issue fully resolved");
  });

  it("returns 'modify' with updated note", async () => {
    const runId = makeRunWithLogs();
    mockCallLlm.mockResolvedValueOnce({ text:
      JSON.stringify({
        action: "modify",
        modifiedNote: "Still check imports",
        reason: "Partially resolved",
      }), sessionId: null,
    });

    const result = await evaluateCorrectionNote(runId, "fix the bug", "Check imports and paths");

    expect(result).not.toBeNull();
    expect(result!.action).toBe("modify");
    expect(result!.modifiedNote).toBe("Still check imports");
  });

  it("returns 'keep' when note is still relevant", async () => {
    const runId = makeRunWithLogs();
    mockCallLlm.mockResolvedValueOnce({ text:
      JSON.stringify({ action: "keep", reason: "Guidance still applies" }), sessionId: null,
    });

    const result = await evaluateCorrectionNote(runId, "fix the bug", "Always run lint");

    expect(result).not.toBeNull();
    expect(result!.action).toBe("keep");
  });

  it("returns null when LLM call fails", async () => {
    const runId = makeRunWithLogs();
    mockCallLlm.mockRejectedValueOnce(new Error("LLM unavailable"));

    const result = await evaluateCorrectionNote(runId, "fix the bug", "Some note");

    expect(result).toBeNull();
  });

  it("returns null for invalid action", async () => {
    const runId = makeRunWithLogs();
    mockCallLlm.mockResolvedValueOnce({ text:
      JSON.stringify({ action: "invalid", reason: "bad" }), sessionId: null,
    });

    const result = await evaluateCorrectionNote(runId, "fix the bug", "Some note");

    expect(result).toBeNull();
  });
});

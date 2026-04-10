import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createJob } from "../src/db/queries/jobs.js";
import { createRun, updateRun } from "../src/db/queries/runs.js";
import { insertRunToolStats, getRunToolStats } from "../src/db/queries/tool-stats.js";

let cleanup: () => void;
let projectId: string;
let jobId: string;

beforeAll(() => {
  cleanup = setupTestDb();
  const project = createProject({
    name: "Tool Stats Project",
    directoryPath: "/tmp/tool-stats-test",
  });
  projectId = project.id;
  const job = createJob({
    projectId,
    name: "Tool Stats Job",
    prompt: "test",
    scheduleType: "manual",
    scheduleConfig: {},
  });
  jobId = job.id;
});

afterAll(() => {
  cleanup();
});

/** Helper: create a succeeded run and attach tool stats */
function createRunWithTools(
  jId: string,
  tools: { toolName: string; invocations: number; approxOutputTokens: number }[],
): string {
  const r = createRun({ jobId: jId, triggerSource: "manual" });
  updateRun({ id: r.id, status: "running", startedAt: new Date().toISOString() });
  updateRun({
    id: r.id,
    status: "succeeded",
    finishedAt: new Date().toISOString(),
    inputTokens: 1000,
    outputTokens: 500,
  });
  insertRunToolStats(r.id, tools);
  return r.id;
}

describe("tool stats queries", () => {
  it("insertRunToolStats stores stats and getRunToolStats aggregates them", () => {
    createRunWithTools(jobId, [
      { toolName: "Bash", invocations: 3, approxOutputTokens: 150 },
      { toolName: "Read", invocations: 5, approxOutputTokens: 200 },
      { toolName: "__reasoning__", invocations: 0, approxOutputTokens: 400 },
    ]);

    createRunWithTools(jobId, [
      { toolName: "Bash", invocations: 2, approxOutputTokens: 100 },
      { toolName: "Edit", invocations: 1, approxOutputTokens: 50 },
      { toolName: "__reasoning__", invocations: 0, approxOutputTokens: 300 },
    ]);

    const stats = getRunToolStats({ projectId });
    expect(stats.length).toBeGreaterThanOrEqual(4);

    const bash = stats.find((s) => s.toolName === "Bash");
    expect(bash).toBeDefined();
    expect(bash!.invocations).toBe(5); // 3 + 2
    expect(bash!.approxOutputTokens).toBe(250); // 150 + 100

    const reasoning = stats.find((s) => s.toolName === "__reasoning__");
    expect(reasoning).toBeDefined();
    expect(reasoning!.invocations).toBe(0);
    expect(reasoning!.approxOutputTokens).toBe(700); // 400 + 300

    const read = stats.find((s) => s.toolName === "Read");
    expect(read!.invocations).toBe(5);

    const edit = stats.find((s) => s.toolName === "Edit");
    expect(edit!.invocations).toBe(1);
  });

  it("insertRunToolStats is a no-op for empty array", () => {
    // Should not throw
    const r = createRun({ jobId, triggerSource: "manual" });
    updateRun({ id: r.id, status: "running", startedAt: new Date().toISOString() });
    updateRun({ id: r.id, status: "succeeded", finishedAt: new Date().toISOString() });
    insertRunToolStats(r.id, []);
  });

  it("getRunToolStats filters by jobIds", () => {
    const job2 = createJob({
      projectId,
      name: "Other Job",
      prompt: "other",
      scheduleType: "manual",
      scheduleConfig: {},
    });

    createRunWithTools(job2.id, [
      { toolName: "mcp__openhelm_browser__navigate", invocations: 10, approxOutputTokens: 500 },
    ]);

    const stats = getRunToolStats({ jobIds: [job2.id] });
    expect(stats.length).toBe(1);
    expect(stats[0].toolName).toBe("mcp__openhelm_browser__navigate");
    expect(stats[0].invocations).toBe(10);
  });

  it("getRunToolStats returns results ordered by invocation count desc", () => {
    const stats = getRunToolStats({ projectId });
    for (let i = 1; i < stats.length; i++) {
      expect(stats[i - 1].invocations).toBeGreaterThanOrEqual(stats[i].invocations);
    }
  });
});

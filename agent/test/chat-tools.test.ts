import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createGoal } from "../src/db/queries/goals.js";
import { createJob } from "../src/db/queries/jobs.js";

vi.mock("../src/ipc/emitter.js", () => ({ emit: vi.fn() }));
vi.mock("../src/executor/index.js", () => ({ executor: { processNext: vi.fn() } }));
vi.mock("../src/memory/embeddings.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(Array(384).fill(0)),
}));
vi.mock("../src/chat/web-fetch.js", () => ({
  searchWeb: vi.fn(),
  fetchUrlAsText: vi.fn(),
}));

import { executeReadTool, executeWriteTool } from "../src/chat/tool-executor.js";
import type { ChatToolCall } from "@openhelm/shared";

function makeCall(tool: string, args: Record<string, unknown> = {}): ChatToolCall {
  return { id: crypto.randomUUID(), tool, args };
}

let cleanup: () => void;
let projectId: string;
let goalId: string;
let jobId: string;

beforeAll(() => {
  cleanup = setupTestDb();
  const project = createProject({ name: "Tool Test Project", directoryPath: "/tmp/tool-test" });
  projectId = project.id;
  const goal = createGoal({ projectId, name: "Test Goal", description: "For tool tests" });
  goalId = goal.id;
  const job = createJob({
    projectId,
    goalId,
    name: "Test Job",
    prompt: "Do something",
    scheduleType: "interval",
    scheduleConfig: { minutes: 60 },
  });
  jobId = job.id;
});

afterAll(() => {
  cleanup();
});

describe("executeReadTool — list_goals", () => {
  it("returns goals for project", async () => {
    const result = await executeReadTool(makeCall("list_goals"), projectId);
    expect(result.error).toBeUndefined();
    const goals = result.result as any[];
    expect(Array.isArray(goals)).toBe(true);
    expect(goals.some((g) => g.id === goalId)).toBe(true);
  });

  it("filters by status", async () => {
    const result = await executeReadTool(makeCall("list_goals", { status: "archived" }), projectId);
    const goals = result.result as any[];
    goals.forEach((g: any) => expect(g.status).toBe("archived"));
  });
});

describe("executeReadTool — list_jobs", () => {
  it("returns jobs for project", async () => {
    const result = await executeReadTool(makeCall("list_jobs"), projectId);
    expect(result.error).toBeUndefined();
    const jobs = result.result as any[];
    expect(jobs.some((j: any) => j.id === jobId)).toBe(true);
  });

  it("filters by goalId", async () => {
    const result = await executeReadTool(makeCall("list_jobs", { goalId }), projectId);
    const jobs = result.result as any[];
    jobs.forEach((j: any) => expect(j.goalId).toBe(goalId));
  });
});

describe("executeReadTool — get_goal", () => {
  it("returns the goal by ID", async () => {
    const result = await executeReadTool(makeCall("get_goal", { goalId }), projectId);
    expect(result.error).toBeUndefined();
    expect((result.result as any).id).toBe(goalId);
  });

  it("returns error for non-existent goal", async () => {
    const result = await executeReadTool(makeCall("get_goal", { goalId: "fake" }), projectId);
    expect(result.error).toContain("not found");
  });

  it("returns error when goalId is missing", async () => {
    const result = await executeReadTool(makeCall("get_goal", {}), projectId);
    expect(result.error).toBeTruthy();
  });
});

describe("executeReadTool — get_job", () => {
  it("returns the job by ID", async () => {
    const result = await executeReadTool(makeCall("get_job", { jobId }), projectId);
    expect(result.error).toBeUndefined();
    expect((result.result as any).id).toBe(jobId);
  });

  it("returns error for non-existent job", async () => {
    const result = await executeReadTool(makeCall("get_job", { jobId: "fake" }), projectId);
    expect(result.error).toContain("not found");
  });
});

describe("executeReadTool — list_runs", () => {
  it("returns runs (possibly empty) for project", async () => {
    const result = await executeReadTool(makeCall("list_runs"), projectId);
    expect(result.error).toBeUndefined();
    expect(Array.isArray(result.result)).toBe(true);
  });
});

describe("executeReadTool — unknown tool", () => {
  it("returns error for unknown tool name", async () => {
    const result = await executeReadTool(makeCall("unknown_tool"), projectId);
    expect(result.error).toContain("Unknown read tool");
  });
});

describe("executeWriteTool — create_goal", () => {
  it("creates a goal and returns it", async () => {
    const result = await executeWriteTool(
      makeCall("create_goal", { name: "AI Created Goal", description: "Via chat" }),
      projectId,
    );
    expect(result.error).toBeUndefined();
    const goal = result.result as any;
    expect(goal.name).toBe("AI Created Goal");
    expect(goal.projectId).toBe(projectId);
  });
});

describe("executeWriteTool — create_job", () => {
  it("creates an interval job", async () => {
    const result = await executeWriteTool(
      makeCall("create_job", {
        name: "AI Job",
        prompt: "Run daily analysis",
        scheduleType: "interval",
        intervalMinutes: 120,
      }),
      projectId,
    );
    expect(result.error).toBeUndefined();
    const job = result.result as any;
    expect(job.name).toBe("AI Job");
    expect(job.scheduleType).toBe("interval");
  });

  it("creates a once job with future fireAt", async () => {
    const result = await executeWriteTool(
      makeCall("create_job", {
        name: "Once Job",
        prompt: "Run once",
        scheduleType: "once",
      }),
      projectId,
    );
    expect(result.error).toBeUndefined();
    const job = result.result as any;
    expect(job.scheduleType).toBe("once");
    // fireAt should be in the future
    expect(new Date((job.scheduleConfig as any).fireAt).getTime()).toBeGreaterThan(Date.now() - 1000);
  });
});

describe("executeWriteTool — update_goal", () => {
  it("updates a goal's name", async () => {
    const result = await executeWriteTool(
      makeCall("update_goal", { goalId, name: "Updated Name" }),
      projectId,
    );
    expect(result.error).toBeUndefined();
    expect((result.result as any).name).toBe("Updated Name");
  });
});

describe("executeWriteTool — archive_goal", () => {
  it("archives a goal", async () => {
    const newGoal = createGoal({ projectId, name: "To Archive" });
    const result = await executeWriteTool(
      makeCall("archive_goal", { goalId: newGoal.id }),
      projectId,
    );
    expect(result.error).toBeUndefined();
    expect((result.result as any).status).toBe("archived");
  });
});

describe("executeWriteTool — archive_job", () => {
  it("archives a job", async () => {
    const newJob = createJob({
      projectId,
      name: "To Archive",
      prompt: "p",
      scheduleType: "interval",
      scheduleConfig: { minutes: 60 },
    });
    const result = await executeWriteTool(
      makeCall("archive_job", { jobId: newJob.id }),
      projectId,
    );
    expect(result.error).toBeUndefined();
    expect((result.result as any).isArchived).toBe(true);
  });
});

describe("executeWriteTool — unknown tool", () => {
  it("returns error for unknown tool name", async () => {
    const result = await executeWriteTool(makeCall("unknown_write"), projectId);
    expect(result.error).toContain("Unknown write tool");
  });
});

describe("executeReadTool — web_search", () => {
  it("calls searchWeb with query and returns results", async () => {
    const { searchWeb } = await import("../src/chat/web-fetch.js");
    const mockResults = [{ title: "Example", url: "https://example.com", snippet: "A site" }];
    vi.mocked(searchWeb).mockResolvedValueOnce(mockResults);

    const result = await executeReadTool(makeCall("web_search", { query: "test query" }), projectId);

    expect(result.error).toBeUndefined();
    expect((result.result as { results: unknown[] }).results).toHaveLength(1);
    expect(vi.mocked(searchWeb)).toHaveBeenCalledWith("test query", undefined);
  });

  it("passes maxResults when provided", async () => {
    const { searchWeb } = await import("../src/chat/web-fetch.js");
    vi.mocked(searchWeb).mockResolvedValueOnce([]);

    await executeReadTool(makeCall("web_search", { query: "q", maxResults: 3 }), projectId);

    expect(vi.mocked(searchWeb)).toHaveBeenCalledWith("q", 3);
  });

  it("returns error when query is missing", async () => {
    const result = await executeReadTool(makeCall("web_search", {}), projectId);
    expect(result.error).toContain("query");
  });
});

describe("executeReadTool — web_fetch", () => {
  it("calls fetchUrlAsText with url and returns result", async () => {
    const { fetchUrlAsText } = await import("../src/chat/web-fetch.js");
    const mockFetchResult = { url: "https://example.com", status: 200, contentType: "text/html", text: "Hello world", truncated: false };
    vi.mocked(fetchUrlAsText).mockResolvedValueOnce(mockFetchResult);

    const result = await executeReadTool(makeCall("web_fetch", { url: "https://example.com" }), projectId);

    expect(result.error).toBeUndefined();
    expect((result.result as typeof mockFetchResult).text).toBe("Hello world");
    expect(vi.mocked(fetchUrlAsText)).toHaveBeenCalledWith("https://example.com", undefined);
  });

  it("passes maxChars when provided", async () => {
    const { fetchUrlAsText } = await import("../src/chat/web-fetch.js");
    vi.mocked(fetchUrlAsText).mockResolvedValueOnce({ url: "https://example.com", status: 200, contentType: "text/html", text: "Hi", truncated: false });

    await executeReadTool(makeCall("web_fetch", { url: "https://example.com", maxChars: 500 }), projectId);

    expect(vi.mocked(fetchUrlAsText)).toHaveBeenCalledWith("https://example.com", 500);
  });

  it("returns error when url is missing", async () => {
    const result = await executeReadTool(makeCall("web_fetch", {}), projectId);
    expect(result.error).toContain("url");
  });
});

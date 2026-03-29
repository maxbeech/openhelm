import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createJob } from "../src/db/queries/jobs.js";
import { createRun } from "../src/db/queries/runs.js";
import { listDashboardItems } from "../src/db/queries/dashboard-items.js";

// Mock the emitter
vi.mock("../src/ipc/emitter.js", () => ({
  emit: vi.fn(),
  send: vi.fn(),
}));

import { emit } from "../src/ipc/emitter.js";
import { isMcpError, handleMcpFailure } from "../src/executor/mcp-monitor.js";

const mockEmit = vi.mocked(emit);

let cleanup: () => void;
let projectId: string;

beforeAll(() => {
  cleanup = setupTestDb();
  const project = createProject({
    name: "MCP Monitor Test",
    directoryPath: "/tmp/mcp-test",
  });
  projectId = project.id;
});

afterAll(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isMcpError", () => {
  it("detects MCP connection refused", () => {
    expect(isMcpError("MCP server connection refused")).toBe(true);
    expect(isMcpError("mcp connection refused on port 9999")).toBe(true);
  });

  it("detects MCP server not running", () => {
    expect(isMcpError("MCP server not running")).toBe(true);
  });

  it("detects failed to connect to MCP", () => {
    expect(isMcpError("failed to connect to mcp server")).toBe(true);
  });

  it("detects MCP timeout", () => {
    expect(isMcpError("MCP server timed out")).toBe(true);
    expect(isMcpError("mcp timeout waiting for response")).toBe(true);
  });

  it("detects MCP unavailable", () => {
    expect(isMcpError("mcp server unavailable")).toBe(true);
  });

  it("detects MCP spawn errors", () => {
    expect(isMcpError("mcp error: spawn ENOENT")).toBe(true);
  });

  it("detects could not start/connect to MCP", () => {
    expect(isMcpError("could not start mcp server")).toBe(true);
    expect(isMcpError("could not connect to mcp")).toBe(true);
  });

  it("returns false for non-MCP errors", () => {
    expect(isMcpError("Error: file not found")).toBe(false);
    expect(isMcpError("npm install failed")).toBe(false);
    expect(isMcpError("connection refused")).toBe(false); // No "mcp" keyword
    expect(isMcpError("")).toBe(false);
  });
});

describe("handleMcpFailure", () => {
  it("creates a dashboard item", () => {
    const job = createJob({
      projectId,
      name: "MCP Test Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "scheduled" });

    handleMcpFailure(run.id, job.id, projectId, "MCP connection refused");

    const items = listDashboardItems({ projectId });
    const mcpItem = items.find((i) => i.type === "mcp_unavailable");
    expect(mcpItem).toBeDefined();
    expect(mcpItem!.title).toContain("MCP server unavailable");
    expect(mcpItem!.title).toContain("MCP Test Job");

    expect(mockEmit).toHaveBeenCalledWith("dashboard.created", expect.objectContaining({
      type: "mcp_unavailable",
    }));
  });

  it("deduplicates — does not create duplicate alerts for same job", () => {
    const job = createJob({
      projectId,
      name: "Dedup MCP Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run1 = createRun({ jobId: job.id, triggerSource: "scheduled" });
    const run2 = createRun({ jobId: job.id, triggerSource: "scheduled" });

    handleMcpFailure(run1.id, job.id, projectId, "error 1");
    mockEmit.mockClear();
    handleMcpFailure(run2.id, job.id, projectId, "error 2");

    // Should NOT have emitted a second dashboard.created
    expect(mockEmit).not.toHaveBeenCalledWith("dashboard.created", expect.anything());
  });

  it("truncates long error messages", () => {
    const job = createJob({
      projectId,
      name: "Long Error Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "scheduled" });

    const longError = "MCP error: " + "x".repeat(500);
    handleMcpFailure(run.id, job.id, projectId, longError);

    const items = listDashboardItems({ projectId });
    const mcpItem = items.find((i) => i.runId === run.id && i.type === "mcp_unavailable");
    expect(mcpItem).toBeDefined();
    expect(mcpItem!.message.length).toBeLessThanOrEqual(300);
  });
});

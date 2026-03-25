import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createJob, listSystemJobsForGoal, disableAllSystemJobs, getJob } from "../src/db/queries/jobs.js";
import { createGoal } from "../src/db/queries/goals.js";
import { setSetting, deleteSetting, getSetting } from "../src/db/queries/settings.js";
import {
  createProposal,
  getProposal,
  listProposals,
  updateProposalStatus,
  expireAllPendingProposals,
} from "../src/db/queries/autopilot-proposals.js";
import type { PlannedSystemJob } from "@openhelm/shared";

// Mock the emitter
vi.mock("../src/ipc/emitter.js", () => ({
  emit: vi.fn(),
  send: vi.fn(),
}));

// Mock Sentry
vi.mock("../src/sentry.js", () => ({
  captureAgentError: vi.fn(),
}));

let cleanup: () => void;
let projectId: string;
let goalId: string;

beforeAll(() => {
  cleanup = setupTestDb();
  const project = createProject({
    name: "Autopilot Test",
    directoryPath: "/tmp/autopilot-test",
  });
  projectId = project.id;
  const goal = createGoal({ projectId, name: "Improve coverage" });
  goalId = goal.id;
});

afterAll(() => cleanup());

function makePlannedSystemJob(overrides?: Partial<PlannedSystemJob>): PlannedSystemJob {
  return {
    name: "Health Watchdog",
    description: "Monitor job health",
    prompt: "Review recent run summaries",
    rationale: "Ensures jobs are running correctly",
    systemCategory: "health_watchdog",
    scheduleType: "cron",
    scheduleConfig: { expression: "0 9 * * 1" },
    ...overrides,
  };
}

describe("job source field", () => {
  it("creates user jobs by default", () => {
    const job = createJob({
      projectId,
      goalId,
      name: "User Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    expect(job.source).toBe("user");
    expect(job.systemCategory).toBeNull();
  });

  it("creates system jobs with source and category", () => {
    const job = createJob({
      projectId,
      goalId,
      name: "System Job",
      prompt: "monitor health",
      scheduleType: "cron",
      scheduleConfig: { expression: "0 9 * * 1" },
      source: "system",
      systemCategory: "health_watchdog",
      model: "claude-haiku-4-5-20251001",
      modelEffort: "low",
    });
    expect(job.source).toBe("system");
    expect(job.systemCategory).toBe("health_watchdog");
    expect(job.model).toBe("claude-haiku-4-5-20251001");
    expect(job.modelEffort).toBe("low");
  });

  it("lists system jobs for a goal", () => {
    const systemJobs = listSystemJobsForGoal(goalId);
    expect(systemJobs.length).toBeGreaterThanOrEqual(1);
    expect(systemJobs.every((j) => j.source === "system")).toBe(true);
  });
});

describe("autopilot proposals CRUD", () => {
  let proposalId: string;

  it("creates a proposal", () => {
    const proposal = createProposal({
      goalId,
      projectId,
      plannedJobs: [makePlannedSystemJob()],
      reason: "Generated monitoring jobs for test coverage goal.",
    });
    proposalId = proposal.id;
    expect(proposal.status).toBe("pending");
    expect(proposal.plannedJobs).toHaveLength(1);
    expect(proposal.plannedJobs[0].systemCategory).toBe("health_watchdog");
  });

  it("gets a proposal by id", () => {
    const proposal = getProposal(proposalId);
    expect(proposal).not.toBeNull();
    expect(proposal!.goalId).toBe(goalId);
  });

  it("lists pending proposals", () => {
    const pending = listProposals({ status: "pending" });
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending.find((p) => p.id === proposalId)).toBeTruthy();
  });

  it("approves a proposal", () => {
    const updated = updateProposalStatus(proposalId, "approved");
    expect(updated.status).toBe("approved");
    expect(updated.resolvedAt).not.toBeNull();
  });

  it("creates and rejects a proposal", () => {
    const proposal = createProposal({
      goalId,
      projectId,
      plannedJobs: [makePlannedSystemJob({ systemCategory: "progress_review" })],
      reason: "Progress monitoring",
    });
    const rejected = updateProposalStatus(proposal.id, "rejected");
    expect(rejected.status).toBe("rejected");
  });
});

describe("autopilot mode effects", () => {
  it("disableAllSystemJobs disables system jobs", () => {
    // Create an enabled system job
    const job = createJob({
      projectId,
      goalId,
      name: "To Disable",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
      source: "system",
      systemCategory: "test_disable",
    });
    expect(job.isEnabled).toBe(true);

    disableAllSystemJobs();

    const updated = getJob(job.id);
    expect(updated!.isEnabled).toBe(false);
  });

  it("expireAllPendingProposals expires pending proposals", () => {
    const proposal = createProposal({
      goalId,
      projectId,
      plannedJobs: [makePlannedSystemJob({ systemCategory: "to_expire" })],
      reason: "Will be expired",
    });
    expect(proposal.status).toBe("pending");

    expireAllPendingProposals();

    const updated = getProposal(proposal.id);
    expect(updated!.status).toBe("expired");
  });
});

describe("autopilot_mode setting", () => {
  it("defaults to full_auto when not set", () => {
    const setting = getSetting("autopilot_mode");
    // Not set = null, which means full_auto (default)
    expect(setting).toBeNull();
  });

  it("can be set to off", () => {
    setSetting("autopilot_mode", "off");
    const setting = getSetting("autopilot_mode");
    expect(setting!.value).toBe("off");
    deleteSetting("autopilot_mode");
  });

  it("can be set to approval_required", () => {
    setSetting("autopilot_mode", "approval_required");
    const setting = getSetting("autopilot_mode");
    expect(setting!.value).toBe("approval_required");
    deleteSetting("autopilot_mode");
  });
});

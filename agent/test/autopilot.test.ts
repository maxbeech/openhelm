import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createJob, listSystemJobsForGoal, disableAllSystemJobs, getJob } from "../src/db/queries/jobs.js";
import { createGoal, listGoals } from "../src/db/queries/goals.js";
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
const mockEmit = vi.fn();
vi.mock("../src/ipc/emitter.js", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  send: vi.fn(),
}));

// Mock Sentry
vi.mock("../src/sentry.js", () => ({
  captureAgentError: vi.fn(),
}));

// Mock system job generation (calls LLM)
const mockGenerateSystemJobs = vi.fn();
vi.mock("../src/planner/system-jobs.js", () => ({
  generateSystemJobs: (...args: unknown[]) => mockGenerateSystemJobs(...args),
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

describe("generateAndHandleSystemJobs", () => {
  // Import after mocks are set up
  let generateAndHandleSystemJobs: typeof import("../src/autopilot/index.js").generateAndHandleSystemJobs;

  beforeAll(async () => {
    const mod = await import("../src/autopilot/index.js");
    generateAndHandleSystemJobs = mod.generateAndHandleSystemJobs;
  });

  beforeEach(() => {
    mockGenerateSystemJobs.mockReset();
    mockEmit.mockClear();
    deleteSetting("autopilot_mode");
  });

  it("creates system jobs in full_auto mode", async () => {
    mockGenerateSystemJobs.mockResolvedValue([
      makePlannedSystemJob({ systemCategory: "gen_test_health" }),
    ]);

    await generateAndHandleSystemJobs(goalId, projectId);

    expect(mockGenerateSystemJobs).toHaveBeenCalledWith(goalId, projectId);
    expect(mockEmit).toHaveBeenCalledWith(
      "autopilot.systemJobsCreated",
      expect.objectContaining({ goalId }),
    );
  });

  it("emits generationFailed when LLM returns no jobs", async () => {
    mockGenerateSystemJobs.mockResolvedValue([]);

    await generateAndHandleSystemJobs(goalId, projectId);

    expect(mockEmit).toHaveBeenCalledWith(
      "autopilot.generationFailed",
      expect.objectContaining({
        goalId,
        projectId,
        error: "No system jobs were generated by the LLM",
      }),
    );
  });

  it("emits generationFailed when LLM call throws", async () => {
    mockGenerateSystemJobs.mockRejectedValue(new Error("CLI timeout"));

    await generateAndHandleSystemJobs(goalId, projectId);

    expect(mockEmit).toHaveBeenCalledWith(
      "autopilot.generationFailed",
      expect.objectContaining({
        goalId,
        projectId,
        error: "CLI timeout",
      }),
    );
  });

  it("does nothing when autopilot is off", async () => {
    setSetting("autopilot_mode", "off");

    await generateAndHandleSystemJobs(goalId, projectId);

    expect(mockGenerateSystemJobs).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

describe("backfillMissingAutopilotJobs", () => {
  let backfillMissingAutopilotJobs: typeof import("../src/autopilot/index.js").backfillMissingAutopilotJobs;
  let backfillGoalNoJobs: string;
  let backfillGoalWithJobs: string;

  beforeAll(async () => {
    const mod = await import("../src/autopilot/index.js");
    backfillMissingAutopilotJobs = mod.backfillMissingAutopilotJobs;

    // Create two goals: one with system jobs, one without
    const g1 = createGoal({ projectId, name: "Goal without system jobs", description: "Improve test coverage across all modules" });
    backfillGoalNoJobs = g1.id;

    const g2 = createGoal({ projectId, name: "Goal with system jobs" });
    backfillGoalWithJobs = g2.id;
    createJob({
      projectId,
      goalId: g2.id,
      name: "Existing system job",
      prompt: "test",
      scheduleType: "cron",
      scheduleConfig: { expression: "0 9 * * 1" },
      source: "system",
      systemCategory: "existing_watchdog",
    });
  });

  beforeEach(() => {
    mockGenerateSystemJobs.mockReset();
    mockEmit.mockClear();
    deleteSetting("autopilot_mode");
    deleteSetting("autopilot_backfill_failures");
  });

  it("backfills goals without system jobs", async () => {
    mockGenerateSystemJobs.mockResolvedValue([
      makePlannedSystemJob({ systemCategory: "backfill_watchdog" }),
    ]);

    await backfillMissingAutopilotJobs();

    // Should have been called for the goal without system jobs (and the original goalId)
    const calledGoalIds = mockGenerateSystemJobs.mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(calledGoalIds).toContain(backfillGoalNoJobs);
    // Should NOT have been called for the goal that already has system jobs
    expect(calledGoalIds).not.toContain(backfillGoalWithJobs);
  });

  it("skips backfill when autopilot is off", async () => {
    setSetting("autopilot_mode", "off");

    await backfillMissingAutopilotJobs();

    expect(mockGenerateSystemJobs).not.toHaveBeenCalled();
  });

  it("skips goals on cooldown from recent failure", async () => {
    // Create fresh goal so it has no system jobs from prior tests
    const freshGoal = createGoal({ projectId, name: "Cooldown goal", description: "Has enough context for backfill" });
    const map: Record<string, number> = { [freshGoal.id]: Date.now() };
    setSetting("autopilot_backfill_failures", JSON.stringify(map));

    mockGenerateSystemJobs.mockResolvedValue([
      makePlannedSystemJob({ systemCategory: "cooldown_test" }),
    ]);

    await backfillMissingAutopilotJobs();

    const calledGoalIds = mockGenerateSystemJobs.mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(calledGoalIds).not.toContain(freshGoal.id);
  });

  it("retries goals after cooldown expires", async () => {
    // Create fresh goal so it has no system jobs from prior tests
    const freshGoal = createGoal({ projectId, name: "Retry goal", description: "Has enough context for backfill" });
    const map: Record<string, number> = {
      [freshGoal.id]: Date.now() - 25 * 60 * 60 * 1000,
    };
    setSetting("autopilot_backfill_failures", JSON.stringify(map));

    mockGenerateSystemJobs.mockResolvedValue([
      makePlannedSystemJob({ systemCategory: "retry_test" }),
    ]);

    await backfillMissingAutopilotJobs();

    const calledGoalIds = mockGenerateSystemJobs.mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(calledGoalIds).toContain(freshGoal.id);
  });

  it("skips goals with insufficient context", async () => {
    const thinGoal = createGoal({ projectId, name: "ThinGoalTest" });

    mockGenerateSystemJobs.mockResolvedValue([
      makePlannedSystemJob({ systemCategory: "thin_test" }),
    ]);

    await backfillMissingAutopilotJobs();

    const calledGoalIds = mockGenerateSystemJobs.mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(calledGoalIds).not.toContain(thinGoal.id);
  });

  it("records failure when generation throws", async () => {
    // Create fresh goal with enough context so it passes thin-goal check
    createGoal({ projectId, name: "Fail goal", description: "Will fail generation" });

    mockGenerateSystemJobs.mockRejectedValue(new Error("CLI crash"));

    await backfillMissingAutopilotJobs();

    const setting = getSetting("autopilot_backfill_failures");
    expect(setting).not.toBeNull();
    const map = JSON.parse(setting!.value);
    expect(Object.keys(map).length).toBeGreaterThanOrEqual(1);
  });
});

describe("clearBackfillCooldown", () => {
  let clearBackfillCooldown: typeof import("../src/autopilot/index.js").clearBackfillCooldown;

  beforeAll(async () => {
    const mod = await import("../src/autopilot/index.js");
    clearBackfillCooldown = mod.clearBackfillCooldown;
  });

  it("removes a goal from the failure map", () => {
    const testGoalId = "test-cooldown-goal";
    const map: Record<string, number> = {
      [testGoalId]: Date.now(),
      "other-goal": Date.now(),
    };
    setSetting("autopilot_backfill_failures", JSON.stringify(map));

    clearBackfillCooldown(testGoalId);

    const setting = getSetting("autopilot_backfill_failures");
    expect(setting).not.toBeNull();
    const updated = JSON.parse(setting!.value);
    expect(updated[testGoalId]).toBeUndefined();
    expect(updated["other-goal"]).toBeDefined();
  });

  it("deletes the setting when map becomes empty", () => {
    const testGoalId = "only-goal";
    setSetting(
      "autopilot_backfill_failures",
      JSON.stringify({ [testGoalId]: Date.now() }),
    );

    clearBackfillCooldown(testGoalId);

    const setting = getSetting("autopilot_backfill_failures");
    expect(setting).toBeNull();
  });
});

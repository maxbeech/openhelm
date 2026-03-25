import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { createGoal } from "../src/db/queries/goals.js";
import {
  createJob,
  getJob,
  listJobs,
  updateJob,
  deleteJob,
} from "../src/db/queries/jobs.js";

let cleanup: () => void;
let projectId: string;
let goalId: string;

beforeAll(() => {
  cleanup = setupTestDb();
  const project = createProject({
    name: "Job Test Project",
    directoryPath: "/tmp/job-test",
  });
  projectId = project.id;
  const goal = createGoal({ projectId, name: "Job Goal" });
  goalId = goal.id;
});

afterAll(() => {
  cleanup();
});

describe("job queries", () => {
  it("should create an interval job with computed nextFireAt", () => {
    const job = createJob({
      projectId,
      name: "Interval Job",
      prompt: "Run tests",
      scheduleType: "interval",
      scheduleConfig: { minutes: 60 },
    });

    expect(job.id).toBeDefined();
    expect(job.projectId).toBe(projectId);
    expect(job.goalId).toBeNull();
    expect(job.name).toBe("Interval Job");
    expect(job.scheduleType).toBe("interval");
    expect(job.scheduleConfig).toEqual({ amount: 1, unit: "hours" });
    expect(job.isEnabled).toBe(true);
    expect(job.nextFireAt).toBeDefined();

    // nextFireAt should be ~60 minutes from now
    const nextFire = new Date(job.nextFireAt!);
    const now = new Date();
    const diffMs = nextFire.getTime() - now.getTime();
    expect(diffMs).toBeGreaterThan(59 * 60_000);
    expect(diffMs).toBeLessThan(61 * 60_000);
  });

  it("should create a cron job", () => {
    const job = createJob({
      projectId,
      goalId,
      name: "Cron Job",
      prompt: "Deploy",
      scheduleType: "cron",
      scheduleConfig: { expression: "0 */2 * * *" },
    });

    expect(job.goalId).toBe(goalId);
    expect(job.scheduleType).toBe("cron");
    expect(job.scheduleConfig).toEqual({ expression: "0 */2 * * *" });
    expect(job.nextFireAt).toBeDefined();
  });

  it("should create a once job with future fireAt", () => {
    const futureDate = new Date(
      Date.now() + 24 * 60 * 60_000,
    ).toISOString();

    const job = createJob({
      projectId,
      name: "Once Job",
      prompt: "One time task",
      scheduleType: "once",
      scheduleConfig: { fireAt: futureDate },
    });

    expect(job.scheduleType).toBe("once");
    expect(job.nextFireAt).toBe(futureDate);
  });

  it("should set nextFireAt to null for past once schedule", () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString();

    const job = createJob({
      projectId,
      name: "Past Once Job",
      prompt: "Already past",
      scheduleType: "once",
      scheduleConfig: { fireAt: pastDate },
    });

    expect(job.nextFireAt).toBeNull();
  });

  it("should create a disabled job with null nextFireAt", () => {
    const job = createJob({
      projectId,
      name: "Disabled Job",
      prompt: "Not yet",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
      isEnabled: false,
    });

    expect(job.isEnabled).toBe(false);
    expect(job.nextFireAt).toBeNull();
  });

  it("should reject invalid cron expression", () => {
    expect(() =>
      createJob({
        projectId,
        name: "Bad Cron",
        prompt: "Fail",
        scheduleType: "cron",
        scheduleConfig: { expression: "not a cron" },
      }),
    ).toThrow("Invalid cron expression");
  });

  it("should reject invalid interval", () => {
    expect(() =>
      createJob({
        projectId,
        name: "Bad Interval",
        prompt: "Fail",
        scheduleType: "interval",
        scheduleConfig: { minutes: -5 } as any,
      }),
    ).toThrow();
  });

  it("should get a job by id", () => {
    const created = createJob({
      projectId,
      name: "Get Test",
      prompt: "Test",
      scheduleType: "interval",
      scheduleConfig: { minutes: 15 },
    });

    const fetched = getJob(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    // Verify scheduleConfig is deserialized
    expect(fetched!.scheduleConfig).toEqual({ amount: 15, unit: "minutes" });
  });

  it("should list jobs with filters", () => {
    const all = listJobs({ projectId });
    expect(all.length).toBeGreaterThanOrEqual(5);

    const byGoal = listJobs({ goalId });
    expect(byGoal.length).toBeGreaterThanOrEqual(1);
    byGoal.forEach((j) => expect(j.goalId).toBe(goalId));
  });

  it("should update a job and recompute nextFireAt", () => {
    const job = createJob({
      projectId,
      name: "Update Test",
      prompt: "Original",
      scheduleType: "interval",
      scheduleConfig: { minutes: 30 },
    });

    const updated = updateJob({
      id: job.id,
      prompt: "Updated prompt",
      scheduleConfig: { minutes: 120 },
    });

    expect(updated.prompt).toBe("Updated prompt");
    expect(updated.scheduleConfig).toEqual({ amount: 2, unit: "hours" });

    // nextFireAt should now be ~120 minutes out
    const nextFire = new Date(updated.nextFireAt!);
    const now = new Date();
    const diffMs = nextFire.getTime() - now.getTime();
    expect(diffMs).toBeGreaterThan(119 * 60_000);
    expect(diffMs).toBeLessThan(121 * 60_000);
  });

  it("should set nextFireAt to null when disabling", () => {
    const job = createJob({
      projectId,
      name: "Disable Test",
      prompt: "Test",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });

    expect(job.nextFireAt).toBeDefined();

    const disabled = updateJob({ id: job.id, isEnabled: false });
    expect(disabled.isEnabled).toBe(false);
    expect(disabled.nextFireAt).toBeNull();
  });

  it("should throw when updating non-existent job", () => {
    expect(() => updateJob({ id: "non-existent", name: "Fail" })).toThrow(
      "Job not found",
    );
  });

  it("should delete a job", () => {
    const job = createJob({
      projectId,
      name: "To Delete",
      prompt: "Test",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });

    expect(deleteJob(job.id)).toBe(true);
    expect(getJob(job.id)).toBeNull();
  });

  it("should create a job with silenceTimeoutMinutes", () => {
    const job = createJob({
      projectId,
      name: "Browser Job",
      prompt: "Browse the web",
      scheduleType: "manual",
      scheduleConfig: {},
      silenceTimeoutMinutes: 20,
    });

    expect(job.silenceTimeoutMinutes).toBe(20);
  });

  it("should default silenceTimeoutMinutes to null when not specified", () => {
    const job = createJob({
      projectId,
      name: "Default Silence Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });

    expect(job.silenceTimeoutMinutes).toBeNull();
  });

  it("should update silenceTimeoutMinutes", () => {
    const job = createJob({
      projectId,
      name: "Update Silence Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });

    const updated = updateJob({ id: job.id, silenceTimeoutMinutes: 30 });
    expect(updated.silenceTimeoutMinutes).toBe(30);

    const cleared = updateJob({ id: job.id, silenceTimeoutMinutes: null });
    expect(cleared.silenceTimeoutMinutes).toBeNull();
  });
});

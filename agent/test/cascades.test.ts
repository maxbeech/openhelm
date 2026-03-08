import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb } from "./helpers.js";
import {
  createProject,
  deleteProject,
} from "../src/db/queries/projects.js";
import { createGoal, getGoal, deleteGoal } from "../src/db/queries/goals.js";
import { createJob, getJob, listJobs, deleteJob } from "../src/db/queries/jobs.js";
import { createRun, getRun } from "../src/db/queries/runs.js";
import { createRunLog, listRunLogs } from "../src/db/queries/run-logs.js";

let cleanup: () => void;

beforeAll(() => {
  cleanup = setupTestDb();
});

afterAll(() => {
  cleanup();
});

describe("cascade deletes", () => {
  it("should cascade delete entire hierarchy when project is deleted", () => {
    // Build full hierarchy
    const project = createProject({
      name: "Cascade Test",
      directoryPath: "/tmp/cascade",
    });
    const goal = createGoal({
      projectId: project.id,
      description: "Cascade Goal",
    });
    const job = createJob({
      projectId: project.id,
      goalId: goal.id,
      name: "Cascade Job",
      prompt: "test",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    createRunLog({ runId: run.id, stream: "stdout", text: "log line" });

    // Delete the project
    deleteProject(project.id);

    // Everything should be gone
    expect(getGoal(goal.id)).toBeNull();
    expect(getJob(job.id)).toBeNull();
    expect(getRun(run.id)).toBeNull();
    expect(listRunLogs({ runId: run.id })).toHaveLength(0);
  });

  it("should cascade delete jobs/runs/logs when goal is deleted", () => {
    const project = createProject({
      name: "Goal Cascade",
      directoryPath: "/tmp/goal-cascade",
    });
    const goal = createGoal({
      projectId: project.id,
      description: "Delete Me",
    });
    const job = createJob({
      projectId: project.id,
      goalId: goal.id,
      name: "Goal Job",
      prompt: "test",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    createRunLog({ runId: run.id, stream: "stdout", text: "log" });

    // Delete the goal — job's goalId should become null (SET NULL)
    // But runs and logs under the job remain
    deleteGoal(goal.id);

    expect(getGoal(goal.id)).toBeNull();

    // Job still exists but goalId is now null
    const jobAfter = getJob(job.id);
    expect(jobAfter).not.toBeNull();
    expect(jobAfter!.goalId).toBeNull();

    // Run and logs still exist
    expect(getRun(run.id)).not.toBeNull();
    expect(listRunLogs({ runId: run.id })).toHaveLength(1);
  });

  it("should cascade delete runs and logs when job is deleted", () => {
    const project = createProject({
      name: "Job Cascade",
      directoryPath: "/tmp/job-cascade",
    });
    const job = createJob({
      projectId: project.id,
      name: "Delete Me Job",
      prompt: "test",
      scheduleType: "interval",
      scheduleConfig: { minutes: 10 },
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    createRunLog({ runId: run.id, stream: "stdout", text: "log" });

    // Delete the job
    deleteJob(job.id);

    expect(getJob(job.id)).toBeNull();
    expect(getRun(run.id)).toBeNull();
    expect(listRunLogs({ runId: run.id })).toHaveLength(0);
  });

  it("should allow jobs without a goal (nullable goalId)", () => {
    const project = createProject({
      name: "No Goal Project",
      directoryPath: "/tmp/no-goal",
    });

    const job = createJob({
      projectId: project.id,
      name: "Standalone Job",
      prompt: "I have no goal",
      scheduleType: "once",
      scheduleConfig: {
        fireAt: new Date(Date.now() + 86400_000).toISOString(),
      },
    });

    expect(job.goalId).toBeNull();
    expect(job.id).toBeDefined();
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import {
  createGoal,
  getGoal,
  listGoals,
  updateGoal,
  deleteGoal,
} from "../src/db/queries/goals.js";
import { createJob, listJobs } from "../src/db/queries/jobs.js";

let cleanup: () => void;
let projectId: string;

beforeAll(() => {
  cleanup = setupTestDb();
  const project = createProject({
    name: "Goal Test Project",
    directoryPath: "/tmp/goal-test",
  });
  projectId = project.id;
});

afterAll(() => {
  cleanup();
});

describe("goal queries", () => {
  it("should create a goal with name and default active status", () => {
    const goal = createGoal({
      projectId,
      name: "Improve test coverage",
      description: "Increase coverage from 60% to 80%",
    });

    expect(goal.id).toBeDefined();
    expect(goal.projectId).toBe(projectId);
    expect(goal.name).toBe("Improve test coverage");
    expect(goal.description).toBe("Increase coverage from 60% to 80%");
    expect(goal.status).toBe("active");
    expect(goal.createdAt).toBeDefined();
  });

  it("should create a goal with empty description when omitted", () => {
    const goal = createGoal({ projectId, name: "Minimal Goal" });
    expect(goal.name).toBe("Minimal Goal");
    expect(goal.description).toBe("");
  });

  it("should get a goal by id", () => {
    const created = createGoal({ projectId, name: "Get Test Goal" });

    const fetched = getGoal(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.name).toBe("Get Test Goal");
  });

  it("should return null for non-existent goal", () => {
    expect(getGoal("non-existent")).toBeNull();
  });

  it("should list goals by project", () => {
    const goals = listGoals({ projectId });
    expect(goals.length).toBeGreaterThanOrEqual(2);
    goals.forEach((g) => expect(g.projectId).toBe(projectId));
  });

  it("should list goals filtered by status", () => {
    const goal = createGoal({ projectId, name: "To Pause" });
    updateGoal({ id: goal.id, status: "paused" });

    const paused = listGoals({ projectId, status: "paused" });
    expect(paused.length).toBeGreaterThanOrEqual(1);
    paused.forEach((g) => expect(g.status).toBe("paused"));
  });

  it("should update goal name", () => {
    const goal = createGoal({ projectId, name: "Old Name" });
    const updated = updateGoal({ id: goal.id, name: "New Name" });
    expect(updated.name).toBe("New Name");
  });

  it("should update goal description", () => {
    const goal = createGoal({ projectId, name: "Desc Test", description: "Old" });
    const updated = updateGoal({ id: goal.id, description: "New" });
    expect(updated.description).toBe("New");
  });

  it("should disable all jobs when archiving a goal", () => {
    const goal = createGoal({ projectId, name: "Archive Test" });

    // Create a job under this goal
    createJob({
      projectId,
      goalId: goal.id,
      name: "Test Job",
      prompt: "Do something",
      scheduleType: "interval",
      scheduleConfig: { minutes: 30 },
      isEnabled: true,
    });

    // Archive the goal
    updateGoal({ id: goal.id, status: "archived" });

    // All jobs under this goal should be disabled
    const goalJobs = listJobs({ goalId: goal.id });
    goalJobs.forEach((j) => expect(j.isEnabled).toBe(false));
  });

  it("should throw when updating non-existent goal", () => {
    expect(() =>
      updateGoal({ id: "non-existent", status: "paused" }),
    ).toThrow("Goal not found");
  });

  it("should delete a goal", () => {
    const goal = createGoal({ projectId, name: "To Delete" });
    expect(deleteGoal(goal.id)).toBe(true);
    expect(getGoal(goal.id)).toBeNull();
  });

  it("should throw on foreign key violation (invalid project)", () => {
    expect(() =>
      createGoal({ projectId: "non-existent", name: "Bad FK" }),
    ).toThrow();
  });
});

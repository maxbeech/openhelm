import { describe, it, expect, vi, beforeEach } from "vitest";
import { useGoalStore } from "./goal-store";

vi.mock("@/lib/api", () => ({
  listGoals: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  archiveGoal: vi.fn(),
  deleteGoal: vi.fn(),
}));

import * as api from "@/lib/api";

beforeEach(() => {
  useGoalStore.setState({ goals: [], loading: false, error: null });
  vi.clearAllMocks();
});

const baseGoal = {
  id: "g1",
  projectId: "p1",
  name: "Test goal",
  description: "Test goal description",
  status: "active" as const,
  createdAt: "2025-01-01",
  updatedAt: "2025-01-01",
};

describe("goal-store", () => {
  it("createGoal adds goal to front of state", async () => {
    const newGoal = { ...baseGoal, id: "g-new" };
    vi.mocked(api.createGoal).mockResolvedValue(newGoal);

    const result = await useGoalStore.getState().createGoal({ projectId: "p1", name: "Test goal" });

    expect(result).toEqual(newGoal);
    expect(useGoalStore.getState().goals[0].id).toBe("g-new");
  });

  it("createGoal sets error and rethrows on failure", async () => {
    vi.mocked(api.createGoal).mockRejectedValue(new Error("create failed"));

    await expect(
      useGoalStore.getState().createGoal({ projectId: "p1", name: "Bad" }),
    ).rejects.toThrow("create failed");
    expect(useGoalStore.getState().error).toBeTruthy();
  });

  it("archiveGoal updates goal in state", async () => {
    const goal = { ...baseGoal };
    useGoalStore.setState({ goals: [goal] });

    const archived = { ...goal, status: "archived" as const };
    vi.mocked(api.archiveGoal).mockResolvedValue(archived);

    await useGoalStore.getState().archiveGoal("g1");

    expect(api.archiveGoal).toHaveBeenCalledWith("g1");
    expect(useGoalStore.getState().goals[0].status).toBe("archived");
  });

  it("deleteGoal removes goal from state", async () => {
    const goal = { ...baseGoal };
    useGoalStore.setState({ goals: [goal] });

    vi.mocked(api.deleteGoal).mockResolvedValue({ deleted: true });

    await useGoalStore.getState().deleteGoal("g1");

    expect(api.deleteGoal).toHaveBeenCalledWith("g1");
    expect(useGoalStore.getState().goals).toHaveLength(0);
  });

  it("archiveGoal sets error on failure", async () => {
    useGoalStore.setState({ goals: [{ ...baseGoal }] });

    vi.mocked(api.archiveGoal).mockRejectedValue(new Error("fail"));

    await expect(
      useGoalStore.getState().archiveGoal("g1"),
    ).rejects.toThrow("fail");
    expect(useGoalStore.getState().error).toBeTruthy();
  });

  it("deleteGoal sets error on failure", async () => {
    useGoalStore.setState({ goals: [{ ...baseGoal }] });

    vi.mocked(api.deleteGoal).mockRejectedValue(new Error("fail"));

    await expect(
      useGoalStore.getState().deleteGoal("g1"),
    ).rejects.toThrow("fail");
    expect(useGoalStore.getState().error).toBeTruthy();
  });
});

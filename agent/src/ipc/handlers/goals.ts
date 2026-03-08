import { registerHandler } from "../handler.js";
import * as goalQueries from "../../db/queries/goals.js";
import type {
  CreateGoalParams,
  UpdateGoalParams,
  ListGoalsParams,
} from "@openorchestra/shared";

export function registerGoalHandlers() {
  registerHandler("goals.create", (params) => {
    const p = params as CreateGoalParams;
    if (!p?.projectId) throw new Error("projectId is required");
    if (!p?.description) throw new Error("description is required");
    return goalQueries.createGoal(p);
  });

  registerHandler("goals.get", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const goal = goalQueries.getGoal(id);
    if (!goal) throw new Error(`Goal not found: ${id}`);
    return goal;
  });

  registerHandler("goals.list", (params) => {
    const p = params as ListGoalsParams;
    if (!p?.projectId) throw new Error("projectId is required");
    return goalQueries.listGoals(p);
  });

  registerHandler("goals.update", (params) => {
    const p = params as UpdateGoalParams;
    if (!p?.id) throw new Error("id is required");
    return goalQueries.updateGoal(p);
  });

  registerHandler("goals.delete", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    return { deleted: goalQueries.deleteGoal(id) };
  });
}

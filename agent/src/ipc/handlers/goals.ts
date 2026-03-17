import { registerHandler } from "../handler.js";
import { emit } from "../emitter.js";
import * as goalQueries from "../../db/queries/goals.js";
import { pickIcon } from "../../planner/icon-picker.js";
import { extractMemoriesFromGoal } from "../../memory/goal-extractor.js";
import type {
  CreateGoalParams,
  UpdateGoalParams,
  ListGoalsParams,
} from "@openorchestra/shared";

export function registerGoalHandlers() {
  registerHandler("goals.create", (params) => {
    const p = params as CreateGoalParams;
    if (!p?.projectId) throw new Error("projectId is required");
    if (!p?.name) throw new Error("name is required");
    const goal = goalQueries.createGoal(p);

    // Fire-and-forget: pick an icon in the background
    pickIcon(p.name, p.description).then((icon) => {
      if (icon) {
        goalQueries.updateGoal({ id: goal.id, icon });
        emit("goal.iconUpdated", { id: goal.id, icon });
      }
    });

    // Fire-and-forget: extract memories from goal description
    extractMemoriesFromGoal(p.projectId, goal.id, p.name, p.description).catch((err) =>
      console.error("[goals] memory extraction error:", err),
    );

    return goal;
  });

  registerHandler("goals.get", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const goal = goalQueries.getGoal(id);
    if (!goal) throw new Error(`Goal not found: ${id}`);
    return goal;
  });

  registerHandler("goals.list", (params) => {
    const p = (params ?? {}) as ListGoalsParams;
    return goalQueries.listGoals(p);
  });

  registerHandler("goals.update", (params) => {
    const p = params as UpdateGoalParams;
    if (!p?.id) throw new Error("id is required");
    return goalQueries.updateGoal(p);
  });

  registerHandler("goals.archive", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    return goalQueries.updateGoal({ id, status: "archived" });
  });

  registerHandler("goals.delete", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    return { deleted: goalQueries.deleteGoal(id) };
  });
}

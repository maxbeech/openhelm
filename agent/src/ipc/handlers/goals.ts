import { registerHandler } from "../handler.js";
import { emit } from "../emitter.js";
import * as goalQueries from "../../db/queries/goals.js";
import * as jobQueries from "../../db/queries/jobs.js";
import * as hierarchyQueries from "../../db/queries/goal-hierarchy.js";
import { pickIcon } from "../../planner/icon-picker.js";
import { extractMemoriesFromGoal } from "../../memory/goal-extractor.js";
import type {
  CreateGoalParams,
  UpdateGoalParams,
  ListGoalsParams,
  BulkReorderParams,
  GoalDeleteSnapshot,
} from "@openhelm/shared";

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

    // Note: legacy system job generation removed — Autopilot handles
    // proactive monitoring via its scanner tick.

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

  registerHandler("goals.unarchive", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const goal = goalQueries.updateGoal({ id, status: "active" });
    jobQueries.unarchiveJobsForGoal(id);
    return goal;
  });

  registerHandler("goals.delete", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    // Prevent deletion of system goals
    const goal = goalQueries.getGoal(id);
    if (goal?.isSystem) throw new Error("System goals cannot be deleted");
    // Collect snapshot before deletion for undo support
    const snapshot = hierarchyQueries.getGoalDeleteSnapshot(id);
    const deleted = goalQueries.deleteGoal(id);
    return { deleted, snapshot };
  });

  registerHandler("goals.reorder", (params) => {
    const p = params as BulkReorderParams;
    if (!p?.items?.length) throw new Error("items array is required");
    goalQueries.reorderGoals(p);
    return { ok: true };
  });

  registerHandler("goals.children", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    return hierarchyQueries.getGoalChildren(id);
  });

  registerHandler("goals.ancestors", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    return hierarchyQueries.getGoalAncestors(id);
  });

  registerHandler("goals.restoreDeleted", (params) => {
    const { snapshot } = params as { snapshot: GoalDeleteSnapshot };
    if (!snapshot?.goals?.length) throw new Error("snapshot is required");
    hierarchyQueries.restoreGoalDeleteSnapshot(snapshot);
    // Re-fetch the restored goals to emit events
    for (const g of snapshot.goals) {
      emit("goal.restored", { id: g.id });
    }
    return { restored: snapshot.goals.length };
  });
}

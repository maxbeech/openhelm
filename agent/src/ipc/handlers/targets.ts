import { registerHandler } from "../handler.js";
import * as targetQueries from "../../db/queries/targets.js";
import { evaluateTarget, evaluateTargets } from "../../data-tables/target-evaluator.js";
import type {
  CreateTargetParams,
  UpdateTargetParams,
  ListTargetsParams,
} from "@openhelm/shared";

export function registerTargetHandlers() {
  registerHandler("targets.list", (params) => {
    const p = (params ?? {}) as ListTargetsParams;
    return targetQueries.listTargets(p);
  });

  registerHandler("targets.get", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const target = targetQueries.getTarget(id);
    if (!target) throw new Error(`Target not found: ${id}`);
    return target;
  });

  registerHandler("targets.create", (params) => {
    const p = params as CreateTargetParams;
    if (!p?.projectId) throw new Error("projectId is required");
    if (!p?.dataTableId) throw new Error("dataTableId is required");
    if (!p?.columnId) throw new Error("columnId is required");
    if (p?.targetValue == null) throw new Error("targetValue is required");
    if (!p?.goalId && !p?.jobId) {
      throw new Error("Either goalId or jobId is required");
    }
    if (p?.goalId && p?.jobId) {
      throw new Error("Provide goalId OR jobId, not both");
    }
    return targetQueries.createTarget(p);
  });

  registerHandler("targets.update", (params) => {
    const p = params as UpdateTargetParams;
    if (!p?.id) throw new Error("id is required");
    return targetQueries.updateTarget(p);
  });

  registerHandler("targets.delete", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const deleted = targetQueries.deleteTarget(id);
    return { deleted };
  });

  registerHandler("targets.evaluate", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const target = targetQueries.getTarget(id);
    if (!target) throw new Error(`Target not found: ${id}`);
    return evaluateTarget(target);
  });

  registerHandler("targets.evaluateAll", (params) => {
    const p = params as { goalId?: string; jobId?: string };
    if (!p?.goalId && !p?.jobId) {
      throw new Error("Either goalId or jobId is required");
    }
    const targets = targetQueries.listTargets(p);
    return evaluateTargets(targets);
  });
}

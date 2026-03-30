import { registerHandler } from "../handler.js";
import { emit } from "../emitter.js";
import * as vizQueries from "../../db/queries/visualizations.js";
import type {
  CreateVisualizationParams,
  UpdateVisualizationParams,
  ListVisualizationsParams,
} from "@openhelm/shared";

export function registerVisualizationHandlers() {
  registerHandler("visualizations.list", (params) => {
    const p = (params ?? {}) as ListVisualizationsParams;
    return vizQueries.listVisualizations(p);
  });

  registerHandler("visualizations.listAll", () => {
    return vizQueries.listAllVisualizations();
  });

  registerHandler("visualizations.get", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const viz = vizQueries.getVisualization(id);
    if (!viz) throw new Error(`Visualization not found: ${id}`);
    return viz;
  });

  registerHandler("visualizations.create", (params) => {
    const p = params as CreateVisualizationParams;
    if (!p?.projectId) throw new Error("projectId is required");
    if (!p?.dataTableId) throw new Error("dataTableId is required");
    if (!p?.name) throw new Error("name is required");
    if (!p?.chartType) throw new Error("chartType is required");
    if (!p?.config) throw new Error("config is required");

    const viz = vizQueries.createVisualization(p);
    emit("visualization.created", viz);
    return viz;
  });

  registerHandler("visualizations.update", (params) => {
    const p = params as UpdateVisualizationParams;
    if (!p?.id) throw new Error("id is required");

    const viz = vizQueries.updateVisualization(p);
    emit("visualization.updated", viz);
    return viz;
  });

  registerHandler("visualizations.delete", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const deleted = vizQueries.deleteVisualization(id);
    if (deleted) emit("visualization.deleted", { id });
    return { deleted };
  });

  registerHandler("visualizations.accept", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const viz = vizQueries.updateVisualization({ id, status: "active" });
    emit("visualization.updated", viz);
    return viz;
  });

  registerHandler("visualizations.dismiss", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const viz = vizQueries.updateVisualization({ id, status: "dismissed" });
    emit("visualization.updated", viz);
    return viz;
  });

  registerHandler("visualizations.count", (params) => {
    const { projectId } = (params ?? {}) as { projectId?: string };
    if (!projectId) throw new Error("projectId is required");
    return { count: vizQueries.countVisualizations(projectId) };
  });

  registerHandler("visualizations.countAll", () => {
    return { count: vizQueries.countAllVisualizations() };
  });
}

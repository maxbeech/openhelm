import { registerHandler } from "../handler.js";
import * as projectQueries from "../../db/queries/projects.js";
import type { CreateProjectParams, UpdateProjectParams } from "@openorchestra/shared";

export function registerProjectHandlers() {
  registerHandler("projects.create", (params) => {
    const p = params as CreateProjectParams;
    if (!p?.name) throw new Error("name is required");
    if (!p?.directoryPath) throw new Error("directoryPath is required");
    return projectQueries.createProject(p);
  });

  registerHandler("projects.get", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const project = projectQueries.getProject(id);
    if (!project) throw new Error(`Project not found: ${id}`);
    return project;
  });

  registerHandler("projects.list", () => {
    return projectQueries.listProjects();
  });

  registerHandler("projects.update", (params) => {
    const p = params as UpdateProjectParams;
    if (!p?.id) throw new Error("id is required");
    return projectQueries.updateProject(p);
  });

  registerHandler("projects.delete", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    return { deleted: projectQueries.deleteProject(id) };
  });
}

import { registerHandler } from "../handler.js";
import * as projectQueries from "../../db/queries/projects.js";
import * as connQueries from "../../db/queries/connections.js";
import { syncProjectToPrimaryFolder } from "../../connections/folder-sync.js";
import type { CreateProjectParams, UpdateProjectParams } from "@openhelm/shared";

export function registerProjectHandlers() {
  registerHandler("projects.create", (params) => {
    const p = params as CreateProjectParams;
    if (!p?.name) throw new Error("name is required");
    if (!p?.directoryPath) throw new Error("directoryPath is required");

    const project = projectQueries.createProject(p);

    // Auto-create a non-deletable primary folder connection for this project
    try {
      connQueries.createPrimaryFolderConnection({
        projectId: project.id,
        name: `${project.name} (folder)`,
        path: project.directoryPath,
      });
    } catch (err) {
      console.error("[projects] failed to create primary folder connection (non-fatal):", err);
    }

    return project;
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

  registerHandler("projects.update", async (params) => {
    const p = params as UpdateProjectParams;
    if (!p?.id) throw new Error("id is required");

    const existing = projectQueries.getProject(p.id);
    const project = projectQueries.updateProject(p);

    // If directoryPath changed, sync the primary folder connection
    if (p.directoryPath && existing && p.directoryPath !== existing.directoryPath) {
      try {
        await syncProjectToPrimaryFolder(project.id, project.directoryPath);
      } catch (err) {
        console.error("[projects] failed to sync primary folder connection (non-fatal):", err);
      }
    }

    return project;
  });

  registerHandler("projects.delete", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    return { deleted: projectQueries.deleteProject(id) };
  });
}

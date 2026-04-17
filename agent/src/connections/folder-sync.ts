import * as connQueries from "../db/queries/connections.js";
import * as projectQueries from "../db/queries/projects.js";

/** In-flight sync prevention (avoid ping-pong when both sides update simultaneously) */
const syncInProgress = new Set<string>();

/** Called when a project's directoryPath changes — updates the primary folder connection */
export async function syncProjectToPrimaryFolder(projectId: string, newPath: string): Promise<void> {
  if (syncInProgress.has(projectId)) return;
  syncInProgress.add(projectId);
  try {
    const primary = connQueries.getPrimaryFolderConnection(projectId);
    if (!primary) return;

    const currentPath = (primary.config as { path?: string }).path;
    if (currentPath === newPath) return;

    connQueries.updateConnection({
      id: primary.id,
      config: { ...(primary.config as Record<string, unknown>), path: newPath },
    });
  } finally {
    syncInProgress.delete(projectId);
  }
}

/** Called when a primary folder connection's path changes — updates the project */
export async function syncPrimaryFolderToProject(
  connectionId: string,
  newPath: string,
  projectId: string,
): Promise<void> {
  if (syncInProgress.has(projectId)) return;
  syncInProgress.add(projectId);
  try {
    const project = projectQueries.getProject(projectId);
    if (!project || project.directoryPath === newPath) return;

    projectQueries.updateProject({ id: projectId, directoryPath: newPath });
  } finally {
    syncInProgress.delete(projectId);
  }
}

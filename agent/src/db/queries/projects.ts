import { eq } from "drizzle-orm";
import { getDb } from "../init.js";
import { projects } from "../schema.js";
import type { Project, CreateProjectParams, UpdateProjectParams } from "@openorchestra/shared";

export function createProject(params: CreateProjectParams): Project {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const row = db
    .insert(projects)
    .values({
      id,
      name: params.name,
      description: params.description ?? null,
      directoryPath: params.directoryPath,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return row as Project;
}

export function getProject(id: string): Project | null {
  const db = getDb();
  const row = db.select().from(projects).where(eq(projects.id, id)).get();
  return (row as Project) ?? null;
}

export function listProjects(): Project[] {
  const db = getDb();
  return db.select().from(projects).all() as Project[];
}

export function updateProject(params: UpdateProjectParams): Project {
  const db = getDb();
  const existing = getProject(params.id);
  if (!existing) {
    throw new Error(`Project not found: ${params.id}`);
  }

  const now = new Date().toISOString();
  const row = db
    .update(projects)
    .set({
      ...(params.name !== undefined && { name: params.name }),
      ...(params.description !== undefined && {
        description: params.description,
      }),
      ...(params.directoryPath !== undefined && {
        directoryPath: params.directoryPath,
      }),
      updatedAt: now,
    })
    .where(eq(projects.id, params.id))
    .returning()
    .get();

  return row as Project;
}

export function deleteProject(id: string): boolean {
  const db = getDb();
  const result = db.delete(projects).where(eq(projects.id, id)).run();
  return result.changes > 0;
}

import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../init.js";
import { visualizations } from "../schema.js";
import type {
  Visualization,
  ChartType,
  VisualizationStatus,
  VisualizationSource,
  VisualizationConfig,
  CreateVisualizationParams,
  UpdateVisualizationParams,
  ListVisualizationsParams,
} from "@openhelm/shared";

// ─── Row mapper ───

function rowToVisualization(row: typeof visualizations.$inferSelect): Visualization {
  return {
    ...row,
    goalId: row.goalId ?? null,
    jobId: row.jobId ?? null,
    chartType: row.chartType as ChartType,
    config: JSON.parse(row.config) as VisualizationConfig,
    status: row.status as VisualizationStatus,
    source: row.source as VisualizationSource,
  };
}

// ─── CRUD ───

export function createVisualization(params: CreateVisualizationParams): Visualization {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const row = db
    .insert(visualizations)
    .values({
      id,
      projectId: params.projectId,
      goalId: params.goalId ?? null,
      jobId: params.jobId ?? null,
      dataTableId: params.dataTableId,
      name: params.name,
      chartType: params.chartType,
      config: JSON.stringify(params.config),
      status: params.status ?? "active",
      source: params.source ?? "user",
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return rowToVisualization(row);
}

export function getVisualization(id: string): Visualization | null {
  const db = getDb();
  const row = db.select().from(visualizations).where(eq(visualizations.id, id)).get();
  return row ? rowToVisualization(row) : null;
}

export function listVisualizations(params: ListVisualizationsParams): Visualization[] {
  const db = getDb();
  const conditions: ReturnType<typeof eq>[] = [];

  if (params.projectId) conditions.push(eq(visualizations.projectId, params.projectId));
  if (params.goalId) conditions.push(eq(visualizations.goalId, params.goalId));
  if (params.jobId) conditions.push(eq(visualizations.jobId, params.jobId));
  if (params.dataTableId) conditions.push(eq(visualizations.dataTableId, params.dataTableId));
  if (params.status) conditions.push(eq(visualizations.status, params.status));

  return db
    .select()
    .from(visualizations)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(visualizations.createdAt))
    .all()
    .map(rowToVisualization);
}

export function listAllVisualizations(): Visualization[] {
  const db = getDb();
  return db
    .select()
    .from(visualizations)
    .orderBy(desc(visualizations.updatedAt))
    .all()
    .map(rowToVisualization);
}

export function updateVisualization(params: UpdateVisualizationParams): Visualization {
  const db = getDb();
  const existing = getVisualization(params.id);
  if (!existing) throw new Error(`Visualization not found: ${params.id}`);

  const row = db
    .update(visualizations)
    .set({
      ...(params.name !== undefined && { name: params.name }),
      ...(params.chartType !== undefined && { chartType: params.chartType }),
      ...(params.config !== undefined && { config: JSON.stringify(params.config) }),
      ...(params.status !== undefined && { status: params.status }),
      ...(params.goalId !== undefined && { goalId: params.goalId }),
      ...(params.jobId !== undefined && { jobId: params.jobId }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(visualizations.id, params.id))
    .returning()
    .get();

  return rowToVisualization(row);
}

export function deleteVisualization(id: string): boolean {
  const db = getDb();
  const result = db.delete(visualizations).where(eq(visualizations.id, id)).run();
  return result.changes > 0;
}

export function countVisualizations(projectId: string): number {
  const db = getDb();
  const rows = db
    .select()
    .from(visualizations)
    .where(eq(visualizations.projectId, projectId))
    .all();
  return rows.length;
}

export function countAllVisualizations(): number {
  const db = getDb();
  return db.select().from(visualizations).all().length;
}

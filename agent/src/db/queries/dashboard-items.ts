import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "../init.js";
import { dashboardItems } from "../schema.js";
import type {
  DashboardItem,
  DashboardItemStatus,
  CreateDashboardItemParams,
  ListDashboardItemsParams,
} from "@openhelm/shared";

function rowToDashboardItem(row: typeof dashboardItems.$inferSelect): DashboardItem {
  return {
    ...row,
    resolvedAt: row.resolvedAt ?? null,
  } as DashboardItem;
}

export function createDashboardItem(params: CreateDashboardItemParams): DashboardItem {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const row = db
    .insert(dashboardItems)
    .values({
      id,
      runId: params.runId,
      jobId: params.jobId,
      projectId: params.projectId,
      type: params.type,
      title: params.title,
      message: params.message,
      createdAt: now,
    })
    .returning()
    .get();

  return rowToDashboardItem(row);
}

export function getDashboardItem(id: string): DashboardItem | null {
  const db = getDb();
  const row = db
    .select()
    .from(dashboardItems)
    .where(eq(dashboardItems.id, id))
    .get();
  return row ? rowToDashboardItem(row) : null;
}

export function listDashboardItems(params?: ListDashboardItemsParams): DashboardItem[] {
  const db = getDb();
  const conditions = [];

  if (params?.projectId) {
    conditions.push(eq(dashboardItems.projectId, params.projectId));
  }
  if (params?.status) {
    conditions.push(eq(dashboardItems.status, params.status));
  }

  const query =
    conditions.length > 0
      ? db
          .select()
          .from(dashboardItems)
          .where(and(...conditions))
      : db.select().from(dashboardItems);

  return query
    .orderBy(desc(dashboardItems.createdAt))
    .all()
    .map(rowToDashboardItem);
}

export function resolveDashboardItem(
  id: string,
  status: DashboardItemStatus,
): DashboardItem {
  const db = getDb();
  const now = new Date().toISOString();
  const row = db
    .update(dashboardItems)
    .set({ status, resolvedAt: now })
    .where(eq(dashboardItems.id, id))
    .returning()
    .get();
  if (!row) {
    throw new Error(`Dashboard item not found: ${id}`);
  }
  return rowToDashboardItem(row);
}

export function countOpenDashboardItems(projectId?: string): number {
  const db = getDb();
  const conditions = [eq(dashboardItems.status, "open")];
  if (projectId) {
    conditions.push(eq(dashboardItems.projectId, projectId));
  }

  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(dashboardItems)
    .where(and(...conditions))
    .get();
  return row?.count ?? 0;
}

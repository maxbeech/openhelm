import { eq, and, lte, gt, isNotNull, isNull, max, asc } from "drizzle-orm";
import { getDb } from "../init.js";
import { jobs } from "../schema.js";
import {
  computeNextFireAt,
  validateScheduleConfig,
} from "../../scheduler/schedule.js";
import type {
  Job,
  ScheduleConfig,
  CreateJobParams,
  UpdateJobParams,
  ListJobsParams,
  BulkReorderParams,
} from "@openhelm/shared";
// Lazy import to avoid circular dependencies; power module may not be initialized yet
function cancelWakeLazy(jobId: string): void {
  import("../../power/wake-scheduler.js")
    .then(({ cancelWake }) => cancelWake(jobId))
    .catch(() => {/* non-fatal */});
}

function rescheduleWakeLazy(jobId: string, nextFireAt: string | null): void {
  if (!nextFireAt) {
    cancelWakeLazy(jobId);
    return;
  }
  import("../../power/index.js")
    .then(({ isPowerManagementEnabled, scheduleWake }) => {
      if (isPowerManagementEnabled()) {
        scheduleWake(jobId, new Date(nextFireAt)).catch(() => {/* non-fatal */});
      }
    })
    .catch(() => {/* non-fatal */});
}

function normalizeIntervalConfig(
  scheduleType: string,
  config: ScheduleConfig,
): ScheduleConfig {
  if (scheduleType !== "interval") return config;
  const c = config as Record<string, unknown>;
  if ("minutes" in c && !("unit" in c)) {
    const mins = c.minutes as number;
    if (mins >= 1440 && mins % 1440 === 0) {
      return { amount: mins / 1440, unit: "days" };
    } else if (mins >= 60 && mins % 60 === 0) {
      return { amount: mins / 60, unit: "hours" };
    }
    return { amount: mins, unit: "minutes" };
  }
  return config;
}

function rowToJob(row: typeof jobs.$inferSelect): Job {
  const rawConfig = JSON.parse(row.scheduleConfig) as ScheduleConfig;
  return {
    ...row,
    isEnabled: Boolean(row.isEnabled),
    isArchived: Boolean(row.isArchived),
    scheduleConfig: normalizeIntervalConfig(row.scheduleType, rawConfig),
    model: row.model ?? "sonnet",
    modelEffort: (row.modelEffort ?? "medium") as "low" | "medium" | "high",
    permissionMode: (row.permissionMode ?? "bypassPermissions") as Job["permissionMode"],
    icon: row.icon ?? null,
    correctionNote: row.correctionNote ?? null,
    silenceTimeoutMinutes: row.silenceTimeoutMinutes ?? null,
    source: (row.source ?? "user") as Job["source"],
    systemCategory: row.systemCategory ?? null,
    sortOrder: row.sortOrder ?? 0,
  } as Job;
}

export function createJob(params: CreateJobParams): Job {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  // Validate schedule config
  validateScheduleConfig(params.scheduleType, params.scheduleConfig);

  const isEnabled = params.isEnabled ?? true;
  const nextFireAt = isEnabled
    ? computeNextFireAt(params.scheduleType, params.scheduleConfig)
    : null;

  // Auto-assign next sort_order within the goal (or standalone jobs in the project).
  // For standalone jobs (no goalId), exclude goal-attached jobs from the MAX() query
  // so standalone sort_order values don't get inflated by jobs in other groups.
  const sortConditions = params.goalId
    ? eq(jobs.goalId, params.goalId)
    : and(eq(jobs.projectId, params.projectId), isNull(jobs.goalId));
  const maxResult = db
    .select({ maxOrder: max(jobs.sortOrder) })
    .from(jobs)
    .where(sortConditions!)
    .get();
  const sortOrder = (maxResult?.maxOrder ?? -1) + 1;

  const row = db
    .insert(jobs)
    .values({
      id,
      goalId: params.goalId ?? null,
      projectId: params.projectId,
      name: params.name,
      description: params.description ?? null,
      prompt: params.prompt,
      scheduleType: params.scheduleType,
      scheduleConfig: JSON.stringify(params.scheduleConfig),
      isEnabled,
      workingDirectory: params.workingDirectory ?? null,
      nextFireAt,
      model: params.model ?? "sonnet",
      modelEffort: params.modelEffort ?? "medium",
      permissionMode: params.permissionMode ?? "bypassPermissions",
      silenceTimeoutMinutes: params.silenceTimeoutMinutes ?? null,
      source: params.source ?? "user",
      systemCategory: params.systemCategory ?? null,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return rowToJob(row);
}

export function getJob(id: string): Job | null {
  const db = getDb();
  const row = db.select().from(jobs).where(eq(jobs.id, id)).get();
  return row ? rowToJob(row) : null;
}

export function listJobs(params?: ListJobsParams): Job[] {
  const db = getDb();
  const conditions = [];

  if (params?.projectId) {
    conditions.push(eq(jobs.projectId, params.projectId));
  }
  if (params?.goalId) {
    conditions.push(eq(jobs.goalId, params.goalId));
  }
  if (params?.isEnabled !== undefined) {
    conditions.push(eq(jobs.isEnabled, params.isEnabled));
  }

  const rows =
    conditions.length > 0
      ? db
          .select()
          .from(jobs)
          .where(and(...conditions))
          .orderBy(jobs.sortOrder)
          .all()
      : db.select().from(jobs).orderBy(jobs.sortOrder).all();

  return rows.map(rowToJob);
}

export function updateJob(params: UpdateJobParams): Job {
  const db = getDb();
  const existing = getJob(params.id);
  if (!existing) {
    throw new Error(`Job not found: ${params.id}`);
  }

  const now = new Date().toISOString();

  // Determine final schedule fields
  const scheduleType = params.scheduleType ?? existing.scheduleType;
  const scheduleConfig = params.scheduleConfig ?? existing.scheduleConfig;
  const isEnabled = params.isEnabled ?? existing.isEnabled;

  // Validate if schedule changed
  if (params.scheduleType || params.scheduleConfig) {
    validateScheduleConfig(scheduleType, scheduleConfig);
  }

  // Recompute nextFireAt if schedule or enabled state changed
  let nextFireAt = existing.nextFireAt;
  if (
    params.scheduleType !== undefined ||
    params.scheduleConfig !== undefined ||
    params.isEnabled !== undefined
  ) {
    nextFireAt = isEnabled
      ? computeNextFireAt(scheduleType, scheduleConfig)
      : null;
  }

  // Reschedule wake if nextFireAt changed
  if (
    params.scheduleType !== undefined ||
    params.scheduleConfig !== undefined ||
    params.isEnabled !== undefined
  ) {
    rescheduleWakeLazy(params.id, nextFireAt);
  }

  const row = db
    .update(jobs)
    .set({
      ...(params.name !== undefined && { name: params.name }),
      ...(params.description !== undefined && {
        description: params.description,
      }),
      ...(params.prompt !== undefined && { prompt: params.prompt }),
      ...(params.goalId !== undefined && { goalId: params.goalId }),
      ...(params.workingDirectory !== undefined && {
        workingDirectory: params.workingDirectory,
      }),
      ...(params.scheduleType !== undefined && {
        scheduleType: params.scheduleType,
      }),
      ...(params.scheduleConfig !== undefined && {
        scheduleConfig: JSON.stringify(params.scheduleConfig),
      }),
      ...(params.isEnabled !== undefined && { isEnabled }),
      ...(params.isArchived !== undefined && { isArchived: params.isArchived }),
      ...(params.model !== undefined && { model: params.model }),
      ...(params.modelEffort !== undefined && { modelEffort: params.modelEffort }),
      ...(params.permissionMode !== undefined && { permissionMode: params.permissionMode }),
      ...(params.icon !== undefined && { icon: params.icon }),
      ...(params.correctionNote !== undefined && { correctionNote: params.correctionNote }),
      ...(params.silenceTimeoutMinutes !== undefined && { silenceTimeoutMinutes: params.silenceTimeoutMinutes }),
      nextFireAt,
      updatedAt: now,
    })
    .where(eq(jobs.id, params.id))
    .returning()
    .get();

  return rowToJob(row);
}

export function updateJobNextFireAt(
  id: string,
  nextFireAt: string | null,
): void {
  const db = getDb();
  db.update(jobs)
    .set({ nextFireAt, updatedAt: new Date().toISOString() })
    .where(eq(jobs.id, id))
    .run();
}

/**
 * Find enabled jobs whose nextFireAt is in the past (due for execution).
 * Used by the scheduler on each tick.
 */
export function listDueJobs(): Job[] {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.isEnabled, true),
        eq(jobs.isArchived, false), // guard against stale nextFireAt on archived jobs
        isNotNull(jobs.nextFireAt),
        lte(jobs.nextFireAt, now),
      ),
    )
    .all();
  return rows.map(rowToJob);
}

/**
 * Disable a job and clear its nextFireAt.
 * Used for once-jobs after their single run completes.
 */
export function disableJob(id: string): void {
  const db = getDb();
  db.update(jobs)
    .set({
      isEnabled: false,
      nextFireAt: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(jobs.id, id))
    .run();
  cancelWakeLazy(id);
}

export function archiveJob(id: string): Job {
  const db = getDb();
  const existing = getJob(id);
  if (!existing) {
    throw new Error(`Job not found: ${id}`);
  }
  const row = db
    .update(jobs)
    .set({
      isArchived: true,
      isEnabled: false,
      nextFireAt: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(jobs.id, id))
    .returning()
    .get();
  cancelWakeLazy(id);
  return rowToJob(row);
}

/** Lightweight atomic update for correction note only */
export function updateJobCorrectionNote(
  id: string,
  correctionNote: string | null,
): void {
  const db = getDb();
  db.update(jobs)
    .set({ correctionNote, updatedAt: new Date().toISOString() })
    .where(eq(jobs.id, id))
    .run();
}

export function unarchiveJob(id: string): Job {
  const db = getDb();
  const existing = getJob(id);
  if (!existing) {
    throw new Error(`Job not found: ${id}`);
  }
  const row = db
    .update(jobs)
    .set({
      isArchived: false,
      isEnabled: false,
      nextFireAt: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(jobs.id, id))
    .returning()
    .get();
  return rowToJob(row);
}

export function unarchiveJobsForGoal(goalId: string): void {
  const db = getDb();
  db.update(jobs)
    .set({
      isArchived: false,
      isEnabled: false,
      nextFireAt: null,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(jobs.goalId, goalId), eq(jobs.isArchived, true)))
    .run();
}

/** List system jobs for a specific goal */
export function listSystemJobsForGoal(goalId: string): Job[] {
  const db = getDb();
  const rows = db
    .select()
    .from(jobs)
    .where(and(eq(jobs.goalId, goalId), eq(jobs.source, "system")))
    .all();
  return rows.map(rowToJob);
}

/** Disable all system jobs (used when autopilot mode is set to "off") */
export function disableAllSystemJobs(): void {
  const db = getDb();
  db.update(jobs)
    .set({
      isEnabled: false,
      nextFireAt: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(jobs.source, "system"))
    .run();
}

export function deleteJob(id: string): boolean {
  const db = getDb();
  const result = db.delete(jobs).where(eq(jobs.id, id)).run();
  if (result.changes > 0) {
    cancelWakeLazy(id);
  }
  return result.changes > 0;
}

/** Bulk-update sort_order for multiple jobs */
export function reorderJobs(params: BulkReorderParams): void {
  const db = getDb();
  const now = new Date().toISOString();
  // Wrapped in a transaction so a partial failure doesn't leave inconsistent sort order.
  db.transaction((tx) => {
    for (const item of params.items) {
      tx.update(jobs)
        .set({ sortOrder: item.sortOrder, updatedAt: now })
        .where(eq(jobs.id, item.id))
        .run();
    }
  });
}

/** List enabled jobs with a future nextFireAt, sorted by fire time. Used by inbox future events. */
export function listDueJobsForInbox(
  projectId: string | null,
  limit = 20,
): Job[] {
  const db = getDb();
  const now = new Date().toISOString();
  const conditions = [
    eq(jobs.isEnabled, true),
    isNotNull(jobs.nextFireAt),
    gt(jobs.nextFireAt, now),
  ];
  if (projectId) {
    conditions.push(eq(jobs.projectId, projectId));
  }
  return db
    .select()
    .from(jobs)
    .where(and(...conditions))
    .orderBy(asc(jobs.nextFireAt))
    .limit(limit)
    .all()
    .map(rowToJob);
}

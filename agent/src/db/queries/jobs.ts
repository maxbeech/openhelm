import { eq, and, lte, isNotNull } from "drizzle-orm";
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
} from "@openorchestra/shared";

function rowToJob(row: typeof jobs.$inferSelect): Job {
  return {
    ...row,
    isEnabled: Boolean(row.isEnabled),
    isArchived: Boolean(row.isArchived),
    scheduleConfig: JSON.parse(row.scheduleConfig) as ScheduleConfig,
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
          .all()
      : db.select().from(jobs).all();

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

  const row = db
    .update(jobs)
    .set({
      ...(params.name !== undefined && { name: params.name }),
      ...(params.description !== undefined && {
        description: params.description,
      }),
      ...(params.prompt !== undefined && { prompt: params.prompt }),
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
  return rowToJob(row);
}

export function deleteJob(id: string): boolean {
  const db = getDb();
  const result = db.delete(jobs).where(eq(jobs.id, id)).run();
  return result.changes > 0;
}

import { eq, and, or, desc, sql } from "drizzle-orm";
import { getDb } from "../init.js";
import { credentials, runCredentials } from "../schema.js";
import { getJob } from "./jobs.js";
import { generateEnvVarName, deduplicateEnvVarName } from "../../credentials/env-var-name.js";
import type {
  Credential,
  CreateCredentialParams,
  UpdateCredentialParams,
  ListCredentialsParams,
} from "@openhelm/shared";

function rowToCredential(row: typeof credentials.$inferSelect): Credential {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Credential["type"],
    envVarName: row.envVarName,
    allowPromptInjection: !!row.allowPromptInjection,
    scopeType: row.scopeType as Credential["scopeType"],
    scopeId: row.scopeId ?? null,
    isEnabled: !!row.isEnabled,
    lastUsedAt: row.lastUsedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Return all existing env_var_name values, optionally excluding one credential by id */
function existingEnvVarNames(excludeId?: string): string[] {
  const db = getDb();
  const rows = db.select({ envVarName: credentials.envVarName }).from(credentials).all();
  return rows
    .filter((r) => r.envVarName && (!excludeId || r.envVarName !== excludeId))
    .map((r) => r.envVarName);
}

export function createCredential(params: CreateCredentialParams): Credential {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Auto-generate env var name, deduplicated against existing names
  const base = generateEnvVarName(params.name);
  const existing = existingEnvVarNames();
  const envVarName = deduplicateEnvVarName(base, existing);

  const row = db
    .insert(credentials)
    .values({
      id,
      name: params.name,
      type: params.type,
      envVarName,
      allowPromptInjection: params.allowPromptInjection ?? false,
      scopeType: params.scopeType ?? "global",
      scopeId: params.scopeId ?? null,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return rowToCredential(row);
}

export function getCredential(id: string): Credential | null {
  const db = getDb();
  const row = db.select().from(credentials).where(eq(credentials.id, id)).get();
  return row ? rowToCredential(row) : null;
}

export function listCredentials(params?: ListCredentialsParams): Credential[] {
  const db = getDb();
  const conditions: ReturnType<typeof eq>[] = [];

  if (params?.type) conditions.push(eq(credentials.type, params.type));
  if (params?.scopeType) conditions.push(eq(credentials.scopeType, params.scopeType));
  if (params?.projectId) {
    // Show credentials accessible by this project: global + project-scoped
    conditions.push(
      or(
        eq(credentials.scopeType, "global"),
        and(eq(credentials.scopeType, "project"), eq(credentials.scopeId, params.projectId))!,
      )!,
    );
  }

  const rows = db
    .select()
    .from(credentials)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(credentials.updatedAt))
    .all();

  return rows.map(rowToCredential);
}

export function updateCredential(params: UpdateCredentialParams): Credential {
  const db = getDb();
  const existing = getCredential(params.id);
  if (!existing) throw new Error(`Credential not found: ${params.id}`);

  // Regenerate env var name if the credential's name changes
  let envVarName: string | undefined;
  if (params.name !== undefined && params.name !== existing.name) {
    const base = generateEnvVarName(params.name);
    // Exclude the current credential's own env_var_name from collision check
    const otherNames = existingEnvVarNames().filter((n) => n !== existing.envVarName);
    envVarName = deduplicateEnvVarName(base, otherNames);
  }

  const row = db
    .update(credentials)
    .set({
      ...(params.name !== undefined && { name: params.name }),
      ...(envVarName !== undefined && { envVarName }),
      ...(params.allowPromptInjection !== undefined && { allowPromptInjection: params.allowPromptInjection }),
      ...(params.scopeType !== undefined && { scopeType: params.scopeType }),
      ...(params.scopeId !== undefined && { scopeId: params.scopeId }),
      ...(params.isEnabled !== undefined && { isEnabled: params.isEnabled }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(credentials.id, params.id))
    .returning()
    .get();

  return rowToCredential(row);
}

export function deleteCredential(id: string): boolean {
  const db = getDb();
  const result = db.delete(credentials).where(eq(credentials.id, id)).run();
  return result.changes > 0;
}

export function touchCredential(id: string): void {
  const db = getDb();
  db.update(credentials)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(credentials.id, id))
    .run();
}

/**
 * Resolve all enabled credentials that apply to a given job.
 * Walks the scope hierarchy: job > goal > project > global.
 * Deduplicates by envVarName — narrower scope wins.
 */
export function resolveCredentialsForJob(jobId: string): Credential[] {
  const job = getJob(jobId);
  if (!job) return [];

  const db = getDb();
  const scopeConditions = [eq(credentials.scopeType, "global")];

  scopeConditions.push(
    and(eq(credentials.scopeType, "project"), eq(credentials.scopeId, job.projectId))!,
  );
  if (job.goalId) {
    scopeConditions.push(
      and(eq(credentials.scopeType, "goal"), eq(credentials.scopeId, job.goalId))!,
    );
  }
  scopeConditions.push(
    and(eq(credentials.scopeType, "job"), eq(credentials.scopeId, jobId))!,
  );

  const rows = db
    .select()
    .from(credentials)
    .where(and(eq(credentials.isEnabled, true), or(...scopeConditions)))
    .orderBy(desc(credentials.updatedAt))
    .all()
    .map(rowToCredential);

  // Deduplicate by envVarName — narrowest scope wins
  const scopePriority: Record<string, number> = { job: 0, goal: 1, project: 2, global: 3 };
  const seen = new Map<string, Credential>();
  for (const cred of rows) {
    const existing = seen.get(cred.envVarName);
    if (!existing || scopePriority[cred.scopeType] < scopePriority[existing.scopeType]) {
      seen.set(cred.envVarName, cred);
    }
  }

  return [...seen.values()];
}

export function countCredentials(projectId?: string): number {
  const db = getDb();
  if (projectId) {
    const row = db
      .select({ count: sql<number>`count(*)` })
      .from(credentials)
      .where(
        and(
          eq(credentials.isEnabled, true),
          or(
            eq(credentials.scopeType, "global"),
            and(eq(credentials.scopeType, "project"), eq(credentials.scopeId, projectId))!,
          ),
        ),
      )
      .get();
    return row?.count ?? 0;
  }
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(credentials)
    .where(eq(credentials.isEnabled, true))
    .get();
  return row?.count ?? 0;
}

// ─── Run-Credential audit trail ───

export interface RunCredentialEntry {
  credentialId: string;
  injectionMethod: "env" | "prompt";
}

export function saveRunCredentials(runId: string, entries: RunCredentialEntry[]): void {
  if (entries.length === 0) return;
  const db = getDb();
  for (const entry of entries) {
    db.insert(runCredentials)
      .values({ runId, credentialId: entry.credentialId, injectionMethod: entry.injectionMethod })
      .onConflictDoNothing()
      .run();
  }
}

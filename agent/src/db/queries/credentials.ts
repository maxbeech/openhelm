import { eq, and, or, desc, inArray, sql } from "drizzle-orm";
import { getDb } from "../init.js";
import { credentials, credentialScopeBindings, runCredentials } from "../schema.js";
import { getJob } from "./jobs.js";
import { generateEnvVarName, deduplicateEnvVarName } from "../../credentials/env-var-name.js";
import type {
  Credential,
  CredentialScopeBinding,
  CreateCredentialParams,
  UpdateCredentialParams,
  ListCredentialsParams,
  ListCredentialsByScopeParams,
} from "@openhelm/shared";

// ─── Row mappers ───────────────────────────────────────────────────────────────

function loadBindings(credentialId: string): CredentialScopeBinding[] {
  const db = getDb();
  return db
    .select({
      scopeType: credentialScopeBindings.scopeType,
      scopeId: credentialScopeBindings.scopeId,
    })
    .from(credentialScopeBindings)
    .where(eq(credentialScopeBindings.credentialId, credentialId))
    .all() as CredentialScopeBinding[];
}

function rowToCredential(row: typeof credentials.$inferSelect): Credential {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Credential["type"],
    envVarName: row.envVarName,
    allowPromptInjection: !!row.allowPromptInjection,
    allowBrowserInjection: !!row.allowBrowserInjection,
    scopeType: row.scopeType as Credential["scopeType"],
    scopeId: row.scopeId ?? null,
    scopes: loadBindings(row.id),
    isEnabled: !!row.isEnabled,
    lastUsedAt: row.lastUsedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function existingEnvVarNames(excludeId?: string): string[] {
  const db = getDb();
  const rows = db.select({ id: credentials.id, envVarName: credentials.envVarName }).from(credentials).all();
  return rows
    .filter((r) => r.envVarName && (!excludeId || r.id !== excludeId))
    .map((r) => r.envVarName);
}

function writeBindings(credentialId: string, scopes: CredentialScopeBinding[]): void {
  const db = getDb();
  // Wrap delete + re-insert in a transaction so a crash mid-way doesn't leave the credential unbound.
  db.transaction((tx) => {
    tx.delete(credentialScopeBindings)
      .where(eq(credentialScopeBindings.credentialId, credentialId))
      .run();
    for (const s of scopes) {
      tx.insert(credentialScopeBindings)
        .values({ credentialId, scopeType: s.scopeType, scopeId: s.scopeId })
        .onConflictDoNothing()
        .run();
    }
  });
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function createCredential(params: CreateCredentialParams): Credential {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const base = generateEnvVarName(params.name);
  const existing = existingEnvVarNames();
  const envVarName = deduplicateEnvVarName(base, existing);

  // When new multi-scope bindings are provided, store scopeType="global" and use the bindings table.
  // Legacy single-scope params (scopeType/scopeId) are kept for backward compat.
  const newScopes = params.scopes ?? [];
  const scopeType: "global" | "project" | "goal" | "job" =
    newScopes.length > 0 ? "global" : (params.scopeType ?? "global") as "global" | "project" | "goal" | "job";
  const scopeId =
    newScopes.length > 0 ? null : (params.scopeId ?? null);

  db.insert(credentials)
    .values({
      id,
      name: params.name,
      type: params.type,
      envVarName,
      allowPromptInjection: params.allowPromptInjection ?? false,
      allowBrowserInjection: params.allowBrowserInjection ?? false,
      scopeType,
      scopeId,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  if (newScopes.length > 0) writeBindings(id, newScopes);

  const row = db.select().from(credentials).where(eq(credentials.id, id)).get();
  if (!row) throw new Error("Failed to create credential");
  return { ...rowToCredential(row), scopes: newScopes };
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
    const projectId = params.projectId;
    // Credentials accessible by this project: all global + legacy project-scoped + bound via bindings
    const boundIds = db
      .select({ credentialId: credentialScopeBindings.credentialId })
      .from(credentialScopeBindings)
      .where(
        and(
          eq(credentialScopeBindings.scopeType, "project"),
          eq(credentialScopeBindings.scopeId, projectId),
        ),
      )
      .all()
      .map((r) => r.credentialId);

    // Global credentials are always available regardless of bindings
    const globalFilter = eq(credentials.scopeType, "global");

    const legacyProjectFilter = and(
      eq(credentials.scopeType, "project"),
      eq(credentials.scopeId, projectId),
    )!;

    const scopeFilter =
      boundIds.length > 0
        ? or(globalFilter as ReturnType<typeof eq>, legacyProjectFilter, inArray(credentials.id, boundIds) as ReturnType<typeof eq>)!
        : or(globalFilter as ReturnType<typeof eq>, legacyProjectFilter)!;

    conditions.push(scopeFilter as ReturnType<typeof eq>);
  }

  const rows = db
    .select()
    .from(credentials)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(credentials.updatedAt))
    .all();

  return rows.map(rowToCredential);
}

/**
 * List credentials whose scope bindings include the given scope type + id.
 * Does NOT include global credentials — use this to show "which credentials
 * are explicitly assigned to this entity".
 */
export function listCredentialsByScope(params: ListCredentialsByScopeParams): Credential[] {
  const db = getDb();

  // Binding-based
  const boundIds = db
    .select({ credentialId: credentialScopeBindings.credentialId })
    .from(credentialScopeBindings)
    .where(
      and(
        eq(credentialScopeBindings.scopeType, params.scopeType),
        eq(credentialScopeBindings.scopeId, params.scopeId),
      ),
    )
    .all()
    .map((r) => r.credentialId);

  // Also include legacy single-scope credentials
  const legacyFilter = and(
    eq(credentials.scopeType, params.scopeType as "project" | "goal" | "job"),
    eq(credentials.scopeId, params.scopeId),
  )!;

  if (boundIds.length === 0) {
    const rows = db
      .select()
      .from(credentials)
      .where(legacyFilter)
      .orderBy(desc(credentials.updatedAt))
      .all();
    return rows.map(rowToCredential);
  }

  const rows = db
    .select()
    .from(credentials)
    .where(or(legacyFilter, inArray(credentials.id, boundIds)))
    .orderBy(desc(credentials.updatedAt))
    .all();

  return rows.map(rowToCredential);
}

export function updateCredential(params: UpdateCredentialParams): Credential {
  const db = getDb();
  const existing = getCredential(params.id);
  if (!existing) throw new Error(`Credential not found: ${params.id}`);

  let envVarName: string | undefined;
  if (params.name !== undefined && params.name !== existing.name) {
    const base = generateEnvVarName(params.name);
    const otherNames = existingEnvVarNames(params.id);
    envVarName = deduplicateEnvVarName(base, otherNames);
  }

  // Handle scopes update
  let newScopeType: "global" | "project" | "goal" | "job" | undefined;
  let newScopeId: string | null | undefined;

  if (params.scopes !== undefined) {
    // Explicit scopes array provided (may be null for "make global")
    const newScopes = params.scopes ?? [];
    writeBindings(params.id, newScopes);
    newScopeType = "global";
    newScopeId = null;
  } else if (params.scopeType !== undefined) {
    // Legacy single-scope update
    newScopeType = params.scopeType as "global" | "project" | "goal" | "job";
    newScopeId = params.scopeId !== undefined ? params.scopeId : null;
  }

  db.update(credentials)
    .set({
      ...(params.name !== undefined && { name: params.name }),
      ...(envVarName !== undefined && { envVarName }),
      ...(params.allowPromptInjection !== undefined && { allowPromptInjection: params.allowPromptInjection }),
      ...(params.allowBrowserInjection !== undefined && { allowBrowserInjection: params.allowBrowserInjection }),
      ...(newScopeType !== undefined && { scopeType: newScopeType }),
      ...(newScopeId !== undefined && { scopeId: newScopeId }),
      ...(params.isEnabled !== undefined && { isEnabled: params.isEnabled }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(credentials.id, params.id))
    .run();

  const row = db.select().from(credentials).where(eq(credentials.id, params.id)).get();
  if (!row) throw new Error(`Credential not found after update: ${params.id}`);
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
 * Scope hierarchy: job > goal > project > global.
 * Supports both legacy single-scope credentials and the new multi-scope bindings.
 * Deduplicates by envVarName — narrower scope wins.
 */
export function resolveCredentialsForJob(jobId: string): Credential[] {
  const job = getJob(jobId);
  if (!job) return [];

  const db = getDb();

  // ── Legacy single-scope credentials ──────────────────────────────────────
  const legacyConditions = [
    // Global credentials are always available regardless of bindings
    eq(credentials.scopeType, "global"),
    and(eq(credentials.scopeType, "project"), eq(credentials.scopeId, job.projectId))!,
    and(eq(credentials.scopeType, "job"), eq(credentials.scopeId, jobId))!,
  ];
  if (job.goalId) {
    legacyConditions.push(
      and(eq(credentials.scopeType, "goal"), eq(credentials.scopeId, job.goalId))!,
    );
  }

  // ── Binding-based credentials ─────────────────────────────────────────────
  const bindingConditions = [
    and(eq(credentialScopeBindings.scopeType, "project"), eq(credentialScopeBindings.scopeId, job.projectId))!,
    and(eq(credentialScopeBindings.scopeType, "job"), eq(credentialScopeBindings.scopeId, jobId))!,
  ];
  if (job.goalId) {
    bindingConditions.push(
      and(eq(credentialScopeBindings.scopeType, "goal"), eq(credentialScopeBindings.scopeId, job.goalId))!,
    );
  }
  const boundIds = db
    .select({ credentialId: credentialScopeBindings.credentialId })
    .from(credentialScopeBindings)
    .where(or(...bindingConditions))
    .all()
    .map((r) => r.credentialId);

  // Build the final filter: global + legacy non-global + binding-matched
  const globalFilter = eq(credentials.scopeType, "global");
  const nonGlobalLegacy = legacyConditions.slice(1); // remove the global one
  const allMatchConditions: ReturnType<typeof eq>[] = [
    globalFilter,
    ...nonGlobalLegacy as ReturnType<typeof eq>[],
  ];
  if (boundIds.length > 0) {
    allMatchConditions.push(inArray(credentials.id, boundIds) as unknown as ReturnType<typeof eq>);
  }

  const rows = db
    .select()
    .from(credentials)
    .where(and(eq(credentials.isEnabled, true), or(...allMatchConditions)))
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

// ─── Entity-level scope management ────────────────────────────────────────────

/**
 * Atomically replace the set of credentials bound to a single entity.
 * - Adds bindings for any credentialId not yet bound to this (scopeType, scopeId)
 * - Removes bindings for any credential previously bound to this entity but not in the new set
 */
export function setScopeBindingsForEntity(params: {
  scopeType: "project" | "goal" | "job";
  scopeId: string;
  credentialIds: string[];
}): { added: number; removed: number } {
  const db = getDb();
  const { scopeType, scopeId, credentialIds } = params;
  const newSet = new Set(credentialIds);

  // Find currently bound credential IDs for this entity
  const current = db
    .select({ credentialId: credentialScopeBindings.credentialId })
    .from(credentialScopeBindings)
    .where(
      and(
        eq(credentialScopeBindings.scopeType, scopeType),
        eq(credentialScopeBindings.scopeId, scopeId),
      ),
    )
    .all()
    .map((r) => r.credentialId);
  const currentSet = new Set(current);

  const toAdd = credentialIds.filter((id) => !currentSet.has(id));
  const toRemove = current.filter((id) => !newSet.has(id));

  for (const credentialId of toAdd) {
    db.insert(credentialScopeBindings)
      .values({ credentialId, scopeType, scopeId })
      .onConflictDoNothing()
      .run();
  }

  for (const credentialId of toRemove) {
    db.delete(credentialScopeBindings)
      .where(
        and(
          eq(credentialScopeBindings.credentialId, credentialId),
          eq(credentialScopeBindings.scopeType, scopeType),
          eq(credentialScopeBindings.scopeId, scopeId),
        ),
      )
      .run();
  }

  return { added: toAdd.length, removed: toRemove.length };
}

// ─── Run-Credential audit trail ───────────────────────────────────────────────

export interface RunCredentialEntry {
  credentialId: string;
  injectionMethod: "env" | "prompt" | "browser";
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

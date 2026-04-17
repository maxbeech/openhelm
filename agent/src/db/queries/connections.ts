import { eq, and, or, desc, inArray, sql } from "drizzle-orm";
import { getDb } from "../init.js";
import { connections, connectionScopeBindings, runConnections } from "../schema.js";
import { getJob } from "./jobs.js";
import { generateEnvVarName, deduplicateEnvVarName } from "../../connections/env-var-name.js";
import type {
  Connection,
  ConnectionScopeBinding,
  ConnectionConfig,
  ConnectionType,
  ConnectionInstallStatus,
  ConnectionAuthStatus,
  CreateConnectionParams,
  UpdateConnectionParams,
  ListConnectionsParams,
  ListConnectionsByScopeParams,
} from "@openhelm/shared";

// ─── Row mappers ───────────────────────────────────────────────────────────────

function loadBindings(connectionId: string): ConnectionScopeBinding[] {
  const db = getDb();
  return db
    .select({
      scopeType: connectionScopeBindings.scopeType,
      scopeId: connectionScopeBindings.scopeId,
    })
    .from(connectionScopeBindings)
    .where(eq(connectionScopeBindings.connectionId, connectionId))
    .all() as ConnectionScopeBinding[];
}

function rowToConnection(row: typeof connections.$inferSelect): Connection {
  let config: ConnectionConfig;
  try {
    config = JSON.parse(row.config || "{}") as ConnectionConfig;
  } catch {
    config = {};
  }

  return {
    id: row.id,
    name: row.name,
    type: row.type as ConnectionType,
    envVarName: row.envVarName ?? "",
    allowPromptInjection: !!row.allowPromptInjection,
    allowBrowserInjection: !!row.allowBrowserInjection,
    browserProfileName: row.browserProfileName ?? null,
    installStatus: (row.installStatus ?? "not_applicable") as ConnectionInstallStatus,
    installError: row.installError ?? null,
    authStatus: (row.authStatus ?? "not_applicable") as ConnectionAuthStatus,
    oauthTokenExpiresAt: row.oauthTokenExpiresAt ?? null,
    secretRef: row.secretRef ?? "",
    config,
    isDeletable: row.isDeletable !== false,
    scopeType: row.scopeType as Connection["scopeType"],
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
  const rows = db.select({ id: connections.id, envVarName: connections.envVarName }).from(connections).all();
  return rows
    .filter((r) => r.envVarName && (!excludeId || r.id !== excludeId))
    .map((r) => r.envVarName);
}

function writeBindings(connectionId: string, scopes: ConnectionScopeBinding[]): void {
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(connectionScopeBindings)
      .where(eq(connectionScopeBindings.connectionId, connectionId))
      .run();
    for (const s of scopes) {
      tx.insert(connectionScopeBindings)
        .values({ connectionId, scopeType: s.scopeType, scopeId: s.scopeId })
        .onConflictDoNothing()
        .run();
    }
  });
}

/** Types that use a discoverable env var name. plain_text is intentionally excluded:
 * per plan 14c it is always prompt-injected, so no env var is generated. */
const ENV_VAR_TYPES = new Set<ConnectionType>(["token"]);

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function createConnection(params: CreateConnectionParams): Connection {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Auto-generate env var name only for token type (plain_text is prompt-only)
  let envVarName = "";
  if (ENV_VAR_TYPES.has(params.type)) {
    const base = generateEnvVarName(params.name);
    const existing = existingEnvVarNames();
    envVarName = deduplicateEnvVarName(base, existing);
  }

  // Plain-text always injects via prompt — override any passed-in flags.
  const isPlainText = params.type === "plain_text";
  const allowPromptInjection = isPlainText ? true : (params.allowPromptInjection ?? false);
  const allowBrowserInjection = isPlainText ? false : (params.allowBrowserInjection ?? false);

  const newScopes = params.scopes ?? [];
  const scopeType =
    newScopes.length > 0 ? "global" : (params.scopeType ?? "global") as Connection["scopeType"];
  const scopeId =
    newScopes.length > 0 ? null : (params.scopeId ?? null);

  const configJson = JSON.stringify(params.config ?? {});

  db.insert(connections)
    .values({
      id,
      name: params.name,
      type: params.type,
      envVarName,
      allowPromptInjection,
      allowBrowserInjection,
      installStatus: "not_applicable",
      authStatus: "not_applicable",
      secretRef: `keychain:${id}`,
      config: configJson,
      isDeletable: true,
      scopeType,
      scopeId,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  if (newScopes.length > 0) writeBindings(id, newScopes);

  const row = db.select().from(connections).where(eq(connections.id, id)).get();
  if (!row) throw new Error("Failed to create connection");
  return { ...rowToConnection(row), scopes: newScopes };
}

/** Create a primary folder connection for a project (non-deletable) */
export function createPrimaryFolderConnection(params: {
  projectId: string;
  name: string;
  path: string;
}): Connection {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const config = JSON.stringify({
    path: params.path,
    isPrimary: true,
    projectId: params.projectId,
  });

  db.insert(connections)
    .values({
      id,
      name: params.name,
      type: "folder",
      envVarName: "",
      allowPromptInjection: false,
      allowBrowserInjection: false,
      installStatus: "not_applicable",
      authStatus: "not_applicable",
      secretRef: "",
      config,
      isDeletable: false,
      scopeType: "project",
      scopeId: params.projectId,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const row = db.select().from(connections).where(eq(connections.id, id)).get();
  if (!row) throw new Error("Failed to create folder connection");
  return rowToConnection(row);
}

export function getConnection(id: string): Connection | null {
  const db = getDb();
  const row = db.select().from(connections).where(eq(connections.id, id)).get();
  return row ? rowToConnection(row) : null;
}

/** Get the primary folder connection for a project */
export function getPrimaryFolderConnection(projectId: string): Connection | null {
  const db = getDb();
  const rows = db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.type, "folder"),
        eq(connections.scopeType, "project"),
        eq(connections.scopeId, projectId),
      ),
    )
    .all();

  const primary = rows.find((r) => {
    try {
      const cfg = JSON.parse(r.config || "{}");
      return cfg.isPrimary === true;
    } catch {
      return false;
    }
  });

  return primary ? rowToConnection(primary) : null;
}

export function listConnections(params?: ListConnectionsParams): Connection[] {
  const db = getDb();
  const conditions: ReturnType<typeof eq>[] = [];

  if (params?.type) conditions.push(eq(connections.type, params.type));
  if (params?.scopeType) conditions.push(eq(connections.scopeType, params.scopeType));
  if (params?.projectId) {
    const projectId = params.projectId;
    const boundIds = db
      .select({ connectionId: connectionScopeBindings.connectionId })
      .from(connectionScopeBindings)
      .where(
        and(
          eq(connectionScopeBindings.scopeType, "project"),
          eq(connectionScopeBindings.scopeId, projectId),
        ),
      )
      .all()
      .map((r) => r.connectionId);

    const globalFilter = eq(connections.scopeType, "global");
    const legacyProjectFilter = and(
      eq(connections.scopeType, "project"),
      eq(connections.scopeId, projectId),
    )!;

    const scopeFilter =
      boundIds.length > 0
        ? or(globalFilter as ReturnType<typeof eq>, legacyProjectFilter, inArray(connections.id, boundIds) as ReturnType<typeof eq>)!
        : or(globalFilter as ReturnType<typeof eq>, legacyProjectFilter)!;

    conditions.push(scopeFilter as ReturnType<typeof eq>);
  }

  const rows = db
    .select()
    .from(connections)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(connections.updatedAt))
    .all();

  return rows.map(rowToConnection);
}

export function listConnectionsByScope(params: ListConnectionsByScopeParams): Connection[] {
  const db = getDb();

  const boundIds = db
    .select({ connectionId: connectionScopeBindings.connectionId })
    .from(connectionScopeBindings)
    .where(
      and(
        eq(connectionScopeBindings.scopeType, params.scopeType),
        eq(connectionScopeBindings.scopeId, params.scopeId),
      ),
    )
    .all()
    .map((r) => r.connectionId);

  const legacyFilter = and(
    eq(connections.scopeType, params.scopeType as "project" | "goal" | "job"),
    eq(connections.scopeId, params.scopeId),
  )!;

  if (boundIds.length === 0) {
    return db
      .select()
      .from(connections)
      .where(legacyFilter)
      .orderBy(desc(connections.updatedAt))
      .all()
      .map(rowToConnection);
  }

  return db
    .select()
    .from(connections)
    .where(or(legacyFilter, inArray(connections.id, boundIds)))
    .orderBy(desc(connections.updatedAt))
    .all()
    .map(rowToConnection);
}

export function updateConnection(params: UpdateConnectionParams): Connection {
  const db = getDb();
  const existing = getConnection(params.id);
  if (!existing) throw new Error(`Connection not found: ${params.id}`);

  // Guard: primary folder connections cannot be deleted; update is still allowed
  if (params.isEnabled === false && !existing.isDeletable) {
    throw new Error("Primary folder connection cannot be disabled");
  }

  let envVarName: string | undefined;
  if (params.name !== undefined && params.name !== existing.name && ENV_VAR_TYPES.has(existing.type)) {
    const base = generateEnvVarName(params.name);
    const otherNames = existingEnvVarNames(params.id);
    envVarName = deduplicateEnvVarName(base, otherNames);
  }

  let newScopeType: Connection["scopeType"] | undefined;
  let newScopeId: string | null | undefined;

  if (params.scopes !== undefined) {
    const newScopes = params.scopes ?? [];
    writeBindings(params.id, newScopes);
    newScopeType = "global";
    newScopeId = null;
  } else if (params.scopeType !== undefined) {
    newScopeType = params.scopeType;
    newScopeId = params.scopeId !== undefined ? params.scopeId : null;
  }

  // Merge config update
  let configJson: string | undefined;
  if (params.config !== undefined) {
    const mergedConfig = { ...(existing.config as Record<string, unknown>), ...params.config };
    configJson = JSON.stringify(mergedConfig);
  }

  db.update(connections)
    .set({
      ...(params.name !== undefined && { name: params.name }),
      ...(envVarName !== undefined && { envVarName }),
      ...(params.allowPromptInjection !== undefined && { allowPromptInjection: params.allowPromptInjection }),
      ...(params.allowBrowserInjection !== undefined && { allowBrowserInjection: params.allowBrowserInjection }),
      ...(params.browserProfileName !== undefined && { browserProfileName: params.browserProfileName }),
      ...(params.installStatus !== undefined && { installStatus: params.installStatus }),
      ...(params.installError !== undefined && { installError: params.installError }),
      ...(params.authStatus !== undefined && { authStatus: params.authStatus }),
      ...(params.oauthTokenExpiresAt !== undefined && { oauthTokenExpiresAt: params.oauthTokenExpiresAt }),
      ...(configJson !== undefined && { config: configJson }),
      ...(newScopeType !== undefined && { scopeType: newScopeType }),
      ...(newScopeId !== undefined && { scopeId: newScopeId }),
      ...(params.isEnabled !== undefined && { isEnabled: params.isEnabled }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(connections.id, params.id))
    .run();

  const row = db.select().from(connections).where(eq(connections.id, params.id)).get();
  if (!row) throw new Error(`Connection not found after update: ${params.id}`);
  return rowToConnection(row);
}

export function deleteConnection(id: string): boolean {
  const db = getDb();
  const existing = getConnection(id);
  if (existing && !existing.isDeletable) {
    throw new Error("E_CONNECTION_NOT_DELETABLE: This connection cannot be deleted.");
  }
  const result = db.delete(connections).where(eq(connections.id, id)).run();
  return result.changes > 0;
}

export function touchConnection(id: string): void {
  const db = getDb();
  db.update(connections)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(connections.id, id))
    .run();
}

/**
 * Resolve all enabled connections that apply to a given job.
 * Scope hierarchy: job > goal > project > global.
 * Deduplicates by envVarName — narrower scope wins.
 */
export function resolveConnectionsForJob(jobId: string): Connection[] {
  const job = getJob(jobId);
  if (!job) return [];

  const db = getDb();

  const legacyConditions = [
    eq(connections.scopeType, "global"),
    and(eq(connections.scopeType, "project"), eq(connections.scopeId, job.projectId))!,
    and(eq(connections.scopeType, "job"), eq(connections.scopeId, jobId))!,
  ];
  if (job.goalId) {
    legacyConditions.push(
      and(eq(connections.scopeType, "goal"), eq(connections.scopeId, job.goalId))!,
    );
  }

  const bindingConditions = [
    and(eq(connectionScopeBindings.scopeType, "project"), eq(connectionScopeBindings.scopeId, job.projectId))!,
    and(eq(connectionScopeBindings.scopeType, "job"), eq(connectionScopeBindings.scopeId, jobId))!,
  ];
  if (job.goalId) {
    bindingConditions.push(
      and(eq(connectionScopeBindings.scopeType, "goal"), eq(connectionScopeBindings.scopeId, job.goalId))!,
    );
  }
  const boundIds = db
    .select({ connectionId: connectionScopeBindings.connectionId })
    .from(connectionScopeBindings)
    .where(or(...bindingConditions))
    .all()
    .map((r) => r.connectionId);

  const globalFilter = eq(connections.scopeType, "global");
  const nonGlobalLegacy = legacyConditions.slice(1);
  const allMatchConditions: ReturnType<typeof eq>[] = [
    globalFilter,
    ...nonGlobalLegacy as ReturnType<typeof eq>[],
  ];
  if (boundIds.length > 0) {
    allMatchConditions.push(inArray(connections.id, boundIds) as unknown as ReturnType<typeof eq>);
  }

  const rows = db
    .select()
    .from(connections)
    .where(and(eq(connections.isEnabled, true), or(...allMatchConditions)))
    .orderBy(desc(connections.updatedAt))
    .all()
    .map(rowToConnection);

  // Deduplicate by envVarName — narrower scope wins (only relevant for token/plain_text)
  const scopePriority: Record<string, number> = { job: 0, goal: 1, project: 2, global: 3 };
  const seen = new Map<string, Connection>();
  for (const conn of rows) {
    if (!conn.envVarName) continue; // folders/mcps/clis don't deduplicate by env var
    const existing = seen.get(conn.envVarName);
    if (!existing || scopePriority[conn.scopeType] < scopePriority[existing.scopeType]) {
      seen.set(conn.envVarName, conn);
    }
  }

  // Add back non-env-var connections (folder, mcp, cli, browser)
  const nonEnvConns = rows.filter((c) => !c.envVarName);
  return [...seen.values(), ...nonEnvConns];
}

export function countConnections(projectId?: string): number {
  const db = getDb();
  if (projectId) {
    const row = db
      .select({ count: sql<number>`count(*)` })
      .from(connections)
      .where(
        and(
          eq(connections.isEnabled, true),
          or(
            eq(connections.scopeType, "global"),
            and(eq(connections.scopeType, "project"), eq(connections.scopeId, projectId))!,
          ),
        ),
      )
      .get();
    return row?.count ?? 0;
  }
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(connections)
    .where(eq(connections.isEnabled, true))
    .get();
  return row?.count ?? 0;
}

// ─── Entity-level scope management ────────────────────────────────────────────

export function setScopeBindingsForEntity(params: {
  scopeType: "project" | "goal" | "job";
  scopeId: string;
  connectionIds: string[];
}): { added: number; removed: number } {
  const db = getDb();
  const { scopeType, scopeId, connectionIds } = params;
  const newSet = new Set(connectionIds);

  const current = db
    .select({ connectionId: connectionScopeBindings.connectionId })
    .from(connectionScopeBindings)
    .where(
      and(
        eq(connectionScopeBindings.scopeType, scopeType),
        eq(connectionScopeBindings.scopeId, scopeId),
      ),
    )
    .all()
    .map((r) => r.connectionId);
  const currentSet = new Set(current);

  const toAdd = connectionIds.filter((id) => !currentSet.has(id));
  const toRemove = current.filter((id) => !newSet.has(id));

  db.transaction((tx) => {
    for (const connectionId of toAdd) {
      tx.insert(connectionScopeBindings)
        .values({ connectionId, scopeType, scopeId })
        .onConflictDoNothing()
        .run();
    }
    for (const connectionId of toRemove) {
      tx.delete(connectionScopeBindings)
        .where(
          and(
            eq(connectionScopeBindings.connectionId, connectionId),
            eq(connectionScopeBindings.scopeType, scopeType),
            eq(connectionScopeBindings.scopeId, scopeId),
          ),
        )
        .run();
    }
  });

  return { added: toAdd.length, removed: toRemove.length };
}

// ─── Run-Connection audit trail ───────────────────────────────────────────────

export interface RunConnectionEntry {
  connectionId: string;
  injectionMethod: "env" | "prompt" | "browser" | "mcp" | "cli_auth_file" | "folder_path" | "oauth_token";
}

export function saveRunConnections(runId: string, entries: RunConnectionEntry[]): void {
  if (entries.length === 0) return;
  const db = getDb();
  db.transaction((tx) => {
    for (const entry of entries) {
      tx.insert(runConnections)
        .values({ runId, connectionId: entry.connectionId, injectionMethod: entry.injectionMethod })
        .onConflictDoNothing()
        .run();
    }
  });
}

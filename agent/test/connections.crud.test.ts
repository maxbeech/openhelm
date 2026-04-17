import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../src/db/init.js";
import {
  createConnection,
  getConnection,
  listConnections,
  listConnectionsByScope,
  updateConnection,
  deleteConnection,
  resolveConnectionsForJob,
  countConnections,
  saveRunConnections,
  touchConnection,
  setScopeBindingsForEntity,
} from "../src/db/queries/connections.js";
import { generateEnvVarName, deduplicateEnvVarName } from "../src/credentials/env-var-name.js";
import { isAuthError } from "../src/executor/auth-monitor.js";
import { createProject } from "../src/db/queries/projects.js";
import { createGoal } from "../src/db/queries/goals.js";
import { createJob } from "../src/db/queries/jobs.js";
import { createRun } from "../src/db/queries/runs.js";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";

function setupTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "oh-conn-test-"));
  initDatabase(join(dir, "test.db"));
}

function createTestProject() {
  return createProject({ name: "Test Project", directoryPath: "/tmp/test" });
}

// ─── generateEnvVarName ───

describe("generateEnvVarName", () => {
  it("converts connection name to OPENHELM_* env var name", () => {
    expect(generateEnvVarName("GitHub Token")).toBe("OPENHELM_GITHUB_TOKEN");
    expect(generateEnvVarName("My API Key")).toBe("OPENHELM_MY_API_KEY");
    expect(generateEnvVarName("db-password")).toBe("OPENHELM_DB_PASSWORD");
    expect(generateEnvVarName("  spaces  ")).toBe("OPENHELM_SPACES");
    expect(generateEnvVarName("hello123")).toBe("OPENHELM_HELLO123");
  });

  it("falls back to OPENHELM_CONNECTION for empty/symbol-only input", () => {
    expect(generateEnvVarName("")).toBe("OPENHELM_CONNECTION");
    expect(generateEnvVarName("---")).toBe("OPENHELM_CONNECTION");
  });

  it("collapses consecutive underscores", () => {
    expect(generateEnvVarName("a  b  c")).toBe("OPENHELM_A_B_C");
  });
});

describe("deduplicateEnvVarName", () => {
  it("returns base name when no collision", () => {
    expect(deduplicateEnvVarName("OPENHELM_TOKEN", [])).toBe("OPENHELM_TOKEN");
  });

  it("appends _2 on first collision", () => {
    expect(deduplicateEnvVarName("OPENHELM_TOKEN", ["OPENHELM_TOKEN"])).toBe("OPENHELM_TOKEN_2");
  });

  it("finds next available suffix", () => {
    expect(
      deduplicateEnvVarName("OPENHELM_TOKEN", ["OPENHELM_TOKEN", "OPENHELM_TOKEN_2"]),
    ).toBe("OPENHELM_TOKEN_3");
  });
});

// ─── Connection CRUD ───

describe("Connection Queries", () => {
  beforeEach(() => setupTestDb());

  it("creates and retrieves a token connection with auto-generated env var name", () => {
    const conn = createConnection({
      name: "GitHub Token",
      type: "token",
    });

    expect(conn.id).toBeTruthy();
    expect(conn.name).toBe("GitHub Token");
    expect(conn.type).toBe("token");
    expect(conn.envVarName).toBe("OPENHELM_GITHUB_TOKEN");
    expect(conn.allowPromptInjection).toBe(false);
    expect(conn.scopeType).toBe("global");
    expect(conn.isEnabled).toBe(true);

    const fetched = getConnection(conn.id);
    expect(fetched).toEqual(conn);
  });

  it("creates a plain_text connection (prompt-injected only, no env var)", () => {
    const conn = createConnection({
      name: "DB Credentials",
      type: "plain_text",
    });

    expect(conn.type).toBe("plain_text");
    expect(conn.envVarName).toBe("");
    expect(conn.allowPromptInjection).toBe(true);
    expect(conn.allowBrowserInjection).toBe(false);
  });

  it("stores allowPromptInjection flag on token type", () => {
    const conn = createConnection({
      name: "My Secret",
      type: "token",
      allowPromptInjection: true,
    });

    expect(conn.allowPromptInjection).toBe(true);
  });

  it("deduplicates env var names across connections", () => {
    const a = createConnection({ name: "GitHub Token", type: "token" });
    const b = createConnection({ name: "GitHub Token", type: "token" });

    expect(a.envVarName).toBe("OPENHELM_GITHUB_TOKEN");
    expect(b.envVarName).toBe("OPENHELM_GITHUB_TOKEN_2");
  });

  it("lists connections with type filter", () => {
    createConnection({ name: "A", type: "token" });
    createConnection({ name: "B", type: "plain_text" });

    const all = listConnections();
    expect(all).toHaveLength(2);

    const tokensOnly = listConnections({ type: "token" });
    expect(tokensOnly).toHaveLength(1);
    expect(tokensOnly[0].name).toBe("A");
  });

  it("updates a connection name (regenerates env var name)", () => {
    const conn = createConnection({ name: "Old Name", type: "token" });
    expect(conn.envVarName).toBe("OPENHELM_OLD_NAME");

    const updated = updateConnection({ id: conn.id, name: "New Name" });
    expect(updated.name).toBe("New Name");
    expect(updated.envVarName).toBe("OPENHELM_NEW_NAME");
  });

  it("updates allowPromptInjection", () => {
    const conn = createConnection({ name: "Token", type: "token" });
    expect(conn.allowPromptInjection).toBe(false);

    const updated = updateConnection({ id: conn.id, allowPromptInjection: true });
    expect(updated.allowPromptInjection).toBe(true);
  });

  it("deletes a connection", () => {
    const conn = createConnection({ name: "Delete Me", type: "token" });

    const deleted = deleteConnection(conn.id);
    expect(deleted).toBe(true);
    expect(getConnection(conn.id)).toBeNull();
  });

  it("counts enabled connections", () => {
    createConnection({ name: "A", type: "token" });
    const b = createConnection({ name: "B", type: "token" });
    updateConnection({ id: b.id, isEnabled: false });

    expect(countConnections()).toBe(1);
  });

  it("touches lastUsedAt", () => {
    const conn = createConnection({ name: "T", type: "token" });
    expect(conn.lastUsedAt).toBeNull();

    touchConnection(conn.id);
    const fetched = getConnection(conn.id);
    expect(fetched!.lastUsedAt).toBeTruthy();
  });
});

// ─── resolveConnectionsForJob ───

describe("resolveConnectionsForJob", () => {
  beforeEach(() => setupTestDb());

  it("returns global connections for any job", () => {
    const project = createTestProject();
    createConnection({ name: "Global Key", type: "token", scopeType: "global" });

    const job = createJob({
      projectId: project.id,
      name: "Test Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });

    const resolved = resolveConnectionsForJob(job.id);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].name).toBe("Global Key");
  });

  it("includes project-scoped connections", () => {
    const project = createTestProject();
    createConnection({
      name: "Project Key",
      type: "token",
      scopeType: "project",
      scopeId: project.id,
    });

    const job = createJob({
      projectId: project.id,
      name: "Test Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });

    const resolved = resolveConnectionsForJob(job.id);
    expect(resolved).toHaveLength(1);
  });

  it("includes goal-scoped connections for jobs with that goal", () => {
    const project = createTestProject();
    const goal = createGoal({ projectId: project.id, name: "Goal" });

    createConnection({ name: "API Token", type: "token", scopeType: "global" });
    const goalConn = createConnection({
      name: "Goal API Token",
      type: "token",
      scopeType: "goal",
      scopeId: goal.id,
    });

    const job = createJob({
      projectId: project.id,
      goalId: goal.id,
      name: "Test Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });

    const resolved = resolveConnectionsForJob(job.id);
    expect(resolved.length).toBeGreaterThanOrEqual(1);
    expect(resolved.some((c) => c.id === goalConn.id)).toBe(true);
  });

  it("excludes disabled connections", () => {
    const project = createTestProject();
    const conn = createConnection({ name: "Disabled", type: "token" });
    updateConnection({ id: conn.id, isEnabled: false });

    const job = createJob({
      projectId: project.id,
      name: "Test Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });

    const resolved = resolveConnectionsForJob(job.id);
    expect(resolved).toHaveLength(0);
  });

  it("resolves global browser connections created with empty scopes (UI default)", () => {
    const project = createTestProject();
    const conn = createConnection({
      name: "X (Twitter)",
      type: "browser",
      allowBrowserInjection: true,
      scopes: [],
    });

    expect(conn.scopeType).toBe("global");
    expect(conn.allowBrowserInjection).toBe(true);

    const job = createJob({
      projectId: project.id,
      name: "X Engagement",
      prompt: "post on X",
      scheduleType: "manual",
      scheduleConfig: {},
    });

    const resolved = resolveConnectionsForJob(job.id);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].name).toBe("X (Twitter)");
    expect(resolved[0].allowBrowserInjection).toBe(true);
    expect(resolved[0].scopeType).toBe("global");
  });

  it("excludes connections scoped to other projects", () => {
    const project1 = createTestProject();
    const project2 = createProject({ name: "Other", directoryPath: "/tmp/other" });

    createConnection({
      name: "Other Project Key",
      type: "token",
      scopeType: "project",
      scopeId: project2.id,
    });

    const job = createJob({
      projectId: project1.id,
      name: "Test Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });

    const resolved = resolveConnectionsForJob(job.id);
    expect(resolved).toHaveLength(0);
  });
});

// ─── Run-Connection audit trail ───

describe("Run-Connection audit trail", () => {
  beforeEach(() => setupTestDb());

  it("saves run connection entries", () => {
    const project = createTestProject();
    const job = createJob({
      projectId: project.id,
      name: "Test Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    const conn = createConnection({ name: "Key", type: "token" });

    saveRunConnections(run.id, [{ connectionId: conn.id, injectionMethod: "env" }]);
  });
});

// ─── Scope Bindings ────────────────────────────────────────────────────────────

describe("connection scope bindings", () => {
  beforeEach(() => setupTestDb());

  it("creates connection with multi-scope bindings", () => {
    const p1 = createTestProject();
    const p2 = createProject({ name: "Other", directoryPath: "/other" });

    const conn = createConnection({
      name: "Multi Scope Token",
      type: "token",
      scopes: [
        { scopeType: "project", scopeId: p1.id },
        { scopeType: "project", scopeId: p2.id },
      ],
    });

    expect(conn.scopes).toHaveLength(2);
    expect(conn.scopes.some((s) => s.scopeId === p1.id)).toBe(true);
    expect(conn.scopes.some((s) => s.scopeId === p2.id)).toBe(true);
    expect(conn.scopeType).toBe("global");
  });

  it("getConnection returns scopes array", () => {
    const p = createTestProject();
    const conn = createConnection({
      name: "Scoped Token",
      type: "token",
      scopes: [{ scopeType: "project", scopeId: p.id }],
    });

    const fetched = getConnection(conn.id);
    expect(fetched?.scopes).toHaveLength(1);
    expect(fetched?.scopes[0].scopeId).toBe(p.id);
  });

  it("updateConnection replaces all scope bindings when scopes array provided", () => {
    const p1 = createTestProject();
    const p2 = createProject({ name: "Other", directoryPath: "/other" });

    const conn = createConnection({
      name: "Token",
      type: "token",
      scopes: [{ scopeType: "project", scopeId: p1.id }],
    });

    updateConnection({
      id: conn.id,
      scopes: [{ scopeType: "project", scopeId: p2.id }],
    });

    const updated = getConnection(conn.id)!;
    expect(updated.scopes).toHaveLength(1);
    expect(updated.scopes[0].scopeId).toBe(p2.id);
  });

  it("updateConnection with scopes=null makes connection global", () => {
    const p = createTestProject();
    const conn = createConnection({
      name: "Token",
      type: "token",
      scopes: [{ scopeType: "project", scopeId: p.id }],
    });

    updateConnection({ id: conn.id, scopes: null });

    const updated = getConnection(conn.id)!;
    expect(updated.scopes).toHaveLength(0);
  });

  it("listConnectionsByScope returns connections bound to a project", () => {
    const p1 = createTestProject();
    const p2 = createProject({ name: "Other", directoryPath: "/other" });

    const boundConn = createConnection({
      name: "Bound",
      type: "token",
      scopes: [{ scopeType: "project", scopeId: p1.id }],
    });
    createConnection({
      name: "Unrelated",
      type: "token",
      scopes: [{ scopeType: "project", scopeId: p2.id }],
    });

    const results = listConnectionsByScope({ scopeType: "project", scopeId: p1.id });
    expect(results.some((c) => c.id === boundConn.id)).toBe(true);
    expect(results.every((c) => c.id !== "unrelated")).toBe(true);
  });

  it("setScopeBindingsForEntity adds and removes bindings atomically", () => {
    const p = createTestProject();
    const c1 = createConnection({ name: "C1", type: "token" });
    const c2 = createConnection({ name: "C2", type: "token" });
    const c3 = createConnection({ name: "C3", type: "token" });

    setScopeBindingsForEntity({ scopeType: "project", scopeId: p.id, connectionIds: [c1.id, c2.id] });
    let bound = listConnectionsByScope({ scopeType: "project", scopeId: p.id });
    expect(bound.some((c) => c.id === c1.id)).toBe(true);
    expect(bound.some((c) => c.id === c2.id)).toBe(true);

    const result = setScopeBindingsForEntity({ scopeType: "project", scopeId: p.id, connectionIds: [c2.id, c3.id] });
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);

    bound = listConnectionsByScope({ scopeType: "project", scopeId: p.id });
    expect(bound.some((c) => c.id === c1.id)).toBe(false);
    expect(bound.some((c) => c.id === c2.id)).toBe(true);
    expect(bound.some((c) => c.id === c3.id)).toBe(true);
  });

  it("resolveConnectionsForJob includes binding-based connections", () => {
    const project = createTestProject();
    const job = createJob({
      projectId: project.id,
      name: "Binding Job",
      prompt: "test",
      scheduleType: "manual",
      scheduleConfig: {},
    });

    const conn = createConnection({
      name: "Job Bound Conn",
      type: "token",
      scopes: [{ scopeType: "job", scopeId: job.id }],
    });

    const resolved = resolveConnectionsForJob(job.id);
    expect(resolved.some((c) => c.id === conn.id)).toBe(true);
  });

  it("global connections with bindings are available to unbound jobs", () => {
    const project = createTestProject();
    const jobA = createJob({ projectId: project.id, name: "Job A", prompt: "test", scheduleType: "manual", scheduleConfig: {} });
    const jobB = createJob({ projectId: project.id, name: "Job B", prompt: "test", scheduleType: "manual", scheduleConfig: {} });
    const jobC = createJob({ projectId: project.id, name: "Job C", prompt: "test", scheduleType: "manual", scheduleConfig: {} });

    const conn = createConnection({ name: "Bound Global", type: "token" });
    setScopeBindingsForEntity({ scopeType: "job", scopeId: jobA.id, connectionIds: [conn.id] });
    setScopeBindingsForEntity({ scopeType: "job", scopeId: jobB.id, connectionIds: [conn.id] });

    const resolved = resolveConnectionsForJob(jobC.id);
    expect(resolved.some((c) => c.id === conn.id)).toBe(true);
  });
});

// ─── Auth Error Detection ───

describe("isAuthError", () => {
  it("detects OAuth token expired error from Claude Code CLI", () => {
    const stderr = 'Claude Code error: Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired. Please obtain a new token or refresh your existing token."},"request_id":"req_011CZnqQnFGStQqgyGCtmViQ"}';
    expect(isAuthError(stderr)).toBe(true);
  });

  it("detects 'Failed to authenticate' prefix", () => {
    expect(isAuthError("Failed to authenticate. Some error details.")).toBe(true);
  });

  it("detects 'authentication_error' API type", () => {
    expect(isAuthError('{"type":"authentication_error","message":"bad token"}')).toBe(true);
  });

  it("detects existing patterns", () => {
    expect(isAuthError("not logged in")).toBe(true);
    expect(isAuthError("session expired")).toBe(true);
    expect(isAuthError("please log in")).toBe(true);
    expect(isAuthError("authentication failed")).toBe(true);
    expect(isAuthError("sign-in required")).toBe(true);
  });

  it("does not false-positive on normal output", () => {
    expect(isAuthError("Running task successfully")).toBe(false);
    expect(isAuthError("Checking authentication status for user")).toBe(false);
    expect(isAuthError("")).toBe(false);
  });
});

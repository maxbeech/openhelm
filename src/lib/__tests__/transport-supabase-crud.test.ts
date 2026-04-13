/**
 * Tests for the camelCase transform in transport-supabase-crud.
 *
 * We mock the Supabase client so we can feed it snake_case responses and
 * verify the CRUD handler returns camelCase objects to the frontend.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock Supabase client ─────────────────────────────────────────────────────

/**
 * The Supabase query builder is a thenable — when awaited it returns { data, error }.
 * We model this by giving mockQuery a `then()` so `await mockQuery` resolves to
 * `mockQuery._resolve`. Individual tests override `_resolve` to set the result.
 * `.single()` overrides the default resolve with its own resolved value.
 */
function makeQuery() {
  const q: Record<string, unknown> & { _resolve: { data: unknown; error: unknown } } = {
    _resolve: { data: null, error: null },
    then(onfulfilled: (v: unknown) => unknown) {
      return Promise.resolve(q._resolve).then(onfulfilled);
    },
    catch(onrejected: (e: unknown) => unknown) {
      return Promise.resolve(q._resolve).catch(onrejected);
    },
  };

  const methods = ["select", "insert", "update", "upsert", "delete", "eq", "order", "limit"];
  for (const m of methods) {
    q[m] = vi.fn().mockReturnValue(q);
  }

  q.single = vi.fn().mockImplementation(() =>
    Promise.resolve(q._resolve)
  );

  return q;
}

let mockQuery = makeQuery();

const mockSupabase = {
  from: vi.fn(() => mockQuery),
};

vi.mock("../supabase-client", () => ({
  getSupabaseClient: () => mockSupabase,
}));

import { handleCrudRequest } from "../transport-supabase-crud";

const USER_ID = "user-123";

describe("handleCrudRequest — camelCase transform", () => {
  const snakeProject = {
    id: "proj-1",
    user_id: USER_ID,
    name: "My Project",
    description: null,
    directory_path: "/home/user/project",
    git_url: "https://github.com/org/repo",
    created_at: "2026-04-06T00:00:00Z",
    updated_at: "2026-04-06T00:00:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = makeQuery();
    mockSupabase.from.mockReturnValue(mockQuery);
    // Default mock: successful single row
    mockQuery._resolve = { data: snakeProject, error: null };
  });

  it("camelizes keys on projects.get", async () => {
    const result = await handleCrudRequest("projects.get", { id: "proj-1" }, USER_ID) as Record<string, unknown>;

    expect(result.directoryPath).toBe("/home/user/project");
    expect(result.gitUrl).toBe("https://github.com/org/repo");
    expect(result.createdAt).toBe("2026-04-06T00:00:00Z");
    expect(result.updatedAt).toBe("2026-04-06T00:00:00Z");
    expect(result.userId).toBe(USER_ID);
    // Original snake_case keys must NOT be present
    expect((result as Record<string, unknown>).directory_path).toBeUndefined();
    expect((result as Record<string, unknown>).git_url).toBeUndefined();
  });

  it("camelizes array results on projects.list", async () => {
    const rows = [
      { id: "p1", name: "A", directory_path: "/a", git_url: null, created_at: "2026-04-06T00:00:00Z", updated_at: "2026-04-06T00:00:00Z", description: null, user_id: USER_ID },
      { id: "p2", name: "B", directory_path: "/b", git_url: "https://github.com/org/b", created_at: "2026-04-06T00:00:00Z", updated_at: "2026-04-06T00:00:00Z", description: null, user_id: USER_ID },
    ];
    // projects.list awaits the query builder directly (no .single())
    mockQuery._resolve = { data: rows, error: null };

    const result = await handleCrudRequest("projects.list", {}, USER_ID) as Record<string, unknown>[];

    expect(result).toHaveLength(2);
    expect(result[0].directoryPath).toBe("/a");
    expect(result[1].gitUrl).toBe("https://github.com/org/b");
    expect((result[0] as Record<string, unknown>).directory_path).toBeUndefined();
  });

  it("decamelizes params on projects.create", async () => {
    await handleCrudRequest(
      "projects.create",
      { name: "My Project", directoryPath: "/home/user/project", gitUrl: "https://github.com/org/repo", description: "A project" },
      USER_ID,
    );

    const inserted = mockQuery.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.directory_path).toBe("/home/user/project");
    expect(inserted.git_url).toBe("https://github.com/org/repo");
    expect(inserted.user_id).toBe(USER_ID);
    // camelCase keys must NOT appear in DB row
    expect(inserted.directoryPath).toBeUndefined();
    expect(inserted.gitUrl).toBeUndefined();
  });

  it("decamelizes rest params on projects.update", async () => {
    await handleCrudRequest(
      "projects.update",
      { id: "proj-1", directoryPath: "/new/path", gitUrl: "https://github.com/org/new" },
      USER_ID,
    );

    const updated = mockQuery.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updated.directory_path).toBe("/new/path");
    expect(updated.git_url).toBe("https://github.com/org/new");
    expect(updated.directoryPath).toBeUndefined();
  });

  it("returns null for settings.get when row not found (PGRST116)", async () => {
    mockQuery._resolve = {
      data: null,
      error: { code: "PGRST116", message: "The result contains 0 rows" },
    };

    const result = await handleCrudRequest("settings.get", { key: "onboarding_complete" }, USER_ID);
    expect(result).toBeNull();
  });

  it("throws for settings.get on unexpected DB error", async () => {
    mockQuery._resolve = {
      data: null,
      error: { code: "42P01", message: "relation does not exist" },
    };

    await expect(
      handleCrudRequest("settings.get", { key: "onboarding_complete" }, USER_ID),
    ).rejects.toThrow("relation does not exist");
  });

  it("throws for unimplemented methods", async () => {
    await expect(
      handleCrudRequest("unknown.method", {}, USER_ID),
    ).rejects.toThrow("Method not implemented in cloud mode: unknown.method");
  });
});

describe("handleCrudRequest — chat methods", () => {
  const snakeConv = {
    id: "conv-1",
    user_id: USER_ID,
    project_id: "proj-1",
    channel: "app",
    title: "Test Thread",
    sort_order: 0,
    created_at: "2026-04-10T00:00:00Z",
    updated_at: "2026-04-10T00:00:00Z",
  };

  const snakeMsg = {
    id: "msg-1",
    user_id: USER_ID,
    conversation_id: "conv-1",
    role: "user",
    content: "Hello",
    tool_calls: null,
    tool_results: null,
    pending_actions: null,
    created_at: "2026-04-10T00:00:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = makeQuery();
    mockSupabase.from.mockReturnValue(mockQuery);
    mockQuery._resolve = { data: snakeConv, error: null };
  });

  it("chat.createConversation inserts with correct columns and camelizes response", async () => {
    const result = await handleCrudRequest(
      "chat.createConversation",
      { projectId: "proj-1", title: "Test Thread" },
      USER_ID,
    ) as Record<string, unknown>;

    // Check insert was called on "conversations" table
    expect(mockSupabase.from).toHaveBeenCalledWith("conversations");
    const inserted = mockQuery.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.user_id).toBe(USER_ID);
    expect(inserted.project_id).toBe("proj-1");
    expect(inserted.channel).toBe("app");
    expect(inserted.title).toBe("Test Thread");
    expect(typeof inserted.id).toBe("string");

    // Response camelized
    expect(result.projectId).toBe("proj-1");
    expect(result.sortOrder).toBe(0);
    expect(result.createdAt).toBe("2026-04-10T00:00:00Z");
  });

  it("chat.createConversation handles null projectId", async () => {
    await handleCrudRequest("chat.createConversation", { projectId: null }, USER_ID);
    const inserted = mockQuery.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.project_id).toBeNull();
  });

  it("chat.listConversations queries conversations table ordered by sort_order", async () => {
    mockQuery._resolve = { data: [snakeConv], error: null };
    const result = await handleCrudRequest(
      "chat.listConversations",
      { projectId: "proj-1" },
      USER_ID,
    ) as Record<string, unknown>[];

    expect(mockSupabase.from).toHaveBeenCalledWith("conversations");
    expect(mockQuery.order).toHaveBeenCalledWith("sort_order", { ascending: true });
    expect(result[0].projectId).toBe("proj-1");
  });

  it("chat.listMessages queries messages table ordered by created_at", async () => {
    mockQuery._resolve = { data: [snakeMsg], error: null };
    const result = await handleCrudRequest(
      "chat.listMessages",
      { conversationId: "conv-1", limit: 50 },
      USER_ID,
    ) as Record<string, unknown>[];

    expect(mockSupabase.from).toHaveBeenCalledWith("messages");
    expect(mockQuery.eq).toHaveBeenCalledWith("conversation_id", "conv-1");
    expect(mockQuery.order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(result[0].conversationId).toBe("conv-1");
    expect(result[0].content).toBe("Hello");
  });

  it("chat.renameConversation updates title and camelizes response", async () => {
    const result = await handleCrudRequest(
      "chat.renameConversation",
      { conversationId: "conv-1", title: "Renamed" },
      USER_ID,
    ) as Record<string, unknown>;

    expect(mockSupabase.from).toHaveBeenCalledWith("conversations");
    const updated = mockQuery.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updated.title).toBe("Renamed");
    expect(typeof updated.updated_at).toBe("string");
    expect(result.sortOrder).toBe(0);
  });

  it("chat.deleteConversation deletes and returns { deleted: true }", async () => {
    // delete() resolves to { error: null } (no data)
    mockQuery.then = vi.fn().mockImplementation((fn: (v: unknown) => unknown) =>
      Promise.resolve(fn({ error: null })),
    );

    const result = await handleCrudRequest(
      "chat.deleteConversation",
      { conversationId: "conv-1" },
      USER_ID,
    ) as Record<string, unknown>;

    expect(result.deleted).toBe(true);
  });

  it("chat.reorderConversations issues one update per id", async () => {
    await handleCrudRequest(
      "chat.reorderConversations",
      { conversationIds: ["conv-a", "conv-b", "conv-c"] },
      USER_ID,
    );

    // from("conversations") called 3 times (one per id)
    expect(mockSupabase.from).toHaveBeenCalledTimes(3);
    expect(mockSupabase.from).toHaveBeenCalledWith("conversations");
  });

  it("chat.clear deletes messages for the conversation and returns { cleared: true }", async () => {
    mockQuery.then = vi.fn().mockImplementation((fn: (v: unknown) => unknown) =>
      Promise.resolve(fn({ error: null })),
    );

    const result = await handleCrudRequest(
      "chat.clear",
      { conversationId: "conv-1" },
      USER_ID,
    ) as Record<string, unknown>;

    expect(mockSupabase.from).toHaveBeenCalledWith("messages");
    expect(result.cleared).toBe(true);
  });
});

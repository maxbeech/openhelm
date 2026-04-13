/**
 * Unit tests for chat-handler.ts
 *
 * Mocks Supabase, the tool loop, auto-rename, and system-prompt builder to
 * test the chat handler orchestration logic without making real LLM calls.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const USER_ID = "user-abc";
const CONV_ID = "conv-xyz";

// ─── Supabase mock ────────────────────────────────────────────────────────────

function makeChain(result: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: any = {
    _result: result,
    then(fn: (v: unknown) => unknown) {
      return Promise.resolve(chain._result).then(fn);
    },
  };

  for (const m of ["from", "insert", "update", "select", "eq", "in", "order", "limit"]) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }

  chain.single = jest.fn().mockImplementation(() => Promise.resolve(chain._result));
  return chain;
}

let insertUserChain: any;
let insertAssistantChain: any;
let historyChain: any;
let updateChain: any;
let convLookupChain: any;

const mockChannel = {
  subscribe: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  send: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
};

const mockSupabase: any = {
  from: jest.fn(),
  channel: jest.fn().mockReturnValue(mockChannel),
  removeChannel: jest.fn(),
};

jest.unstable_mockModule("../supabase.js", () => ({
  getSupabase: () => mockSupabase,
}));

// ─── Tool loop + auto-rename + system prompt mocks ────────────────────────────

const mockRunChatToolLoop = jest.fn<() => Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: unknown[];
  toolResults: unknown[];
}>>();

jest.unstable_mockModule("../chat/tool-loop.js", () => ({
  runChatToolLoop: mockRunChatToolLoop,
}));

const mockAutoRenameThread = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
jest.unstable_mockModule("../chat/auto-rename.js", () => ({
  autoRenameThread: mockAutoRenameThread,
}));

jest.unstable_mockModule("../chat/system-prompt.js", () => ({
  buildCloudChatSystemPrompt: jest.fn<() => Promise<string>>().mockResolvedValue("test system prompt"),
}));

// tool-schemas.ts is a pure module (no side effects), so we let it import real.

// ─── Import after mocks ───────────────────────────────────────────────────────

const { handleChatSend, handleChatCancel } = await import("../chat-handler.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const userMsgRow = {
  id: "msg-user-1",
  user_id: USER_ID,
  conversation_id: CONV_ID,
  role: "user",
  content: "Hello",
  tool_calls: null,
  tool_results: null,
  pending_actions: null,
  created_at: "2026-04-11T00:00:00Z",
};

const historyRows = [
  { role: "user", content: "Previous message" },
  { role: "assistant", content: "Previous reply" },
];

function setupMocks(options: { convHasTitle?: boolean } = {}) {
  insertUserChain = makeChain({ data: userMsgRow, error: null });
  insertUserChain.single.mockResolvedValue({ data: userMsgRow, error: null });

  const assistantMsgRow = { ...userMsgRow, id: "msg-asst-1", role: "assistant", content: "Hi there!" };
  insertAssistantChain = makeChain({ data: assistantMsgRow, error: null });
  insertAssistantChain.single.mockResolvedValue({ data: assistantMsgRow, error: null });

  historyChain = makeChain({ data: historyRows, error: null });
  updateChain = makeChain({ data: null, error: null });

  const convRow = options.convHasTitle
    ? { title: "Existing Thread" }
    : { title: null };
  convLookupChain = makeChain({ data: convRow, error: null });
  convLookupChain.single.mockResolvedValue({ data: convRow, error: null });

  let messagesCallCount = 0;
  let conversationsCallCount = 0;
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === "messages") {
      messagesCallCount++;
      if (messagesCallCount === 1) return insertUserChain;
      if (messagesCallCount === 2) return historyChain;
      return insertAssistantChain;
    }
    if (table === "conversations") {
      conversationsCallCount++;
      // 1st conversations.from = lookup for auto-rename check (.select/.single)
      // 2nd conversations.from = update updated_at
      if (conversationsCallCount === 1) return convLookupChain;
      return updateChain;
    }
    return makeChain();
  });

  mockChannel.subscribe.mockResolvedValue(undefined);
  mockChannel.send.mockResolvedValue(undefined);
  mockSupabase.channel.mockReturnValue(mockChannel);

  mockRunChatToolLoop.mockResolvedValue({
    text: "Hi there!",
    inputTokens: 10,
    outputTokens: 20,
    toolCalls: [],
    toolResults: [],
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("handleChatSend", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
  });

  it("returns { started: true } on success", async () => {
    const result = await handleChatSend({ conversationId: CONV_ID, content: "Hello" }, USER_ID);
    expect(result).toEqual({ started: true });
  });

  it("inserts user message into messages table", async () => {
    await handleChatSend({ conversationId: CONV_ID, content: "Hello" }, USER_ID);

    expect(insertUserChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: USER_ID,
        conversation_id: CONV_ID,
        role: "user",
        content: "Hello",
      }),
    );
  });

  it("passes history + system prompt + tools to the tool loop", async () => {
    await handleChatSend({ conversationId: CONV_ID, content: "Hello" }, USER_ID);

    expect(mockRunChatToolLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        systemPrompt: "test system prompt",
        history: expect.arrayContaining([
          expect.objectContaining({ role: "user" }),
        ]),
        tools: expect.any(Array),
      }),
    );
  });

  it("passes read-only tools when permissionMode is plan (default)", async () => {
    await handleChatSend({ conversationId: CONV_ID, content: "Hello" }, USER_ID);

    const call = (mockRunChatToolLoop.mock.calls[0] as any[])[0] as { tools: Array<{ function: { name: string } }> };
    const toolNames = call.tools.map((t) => t.function.name);
    expect(toolNames).toContain("web_search");
    expect(toolNames).toContain("web_fetch");
    expect(toolNames).not.toContain("create_goal");
  });

  it("passes full-access tools when permissionMode is bypassPermissions", async () => {
    await handleChatSend(
      { conversationId: CONV_ID, content: "Hello", permissionMode: "bypassPermissions" },
      USER_ID,
    );

    const call = (mockRunChatToolLoop.mock.calls[0] as any[])[0] as { tools: Array<{ function: { name: string } }> };
    const toolNames = call.tools.map((t) => t.function.name);
    expect(toolNames).toContain("web_search");
    expect(toolNames).toContain("create_goal");
    expect(toolNames).toContain("create_job");
  });

  it("inserts assistant message with tool loop response text", async () => {
    await handleChatSend({ conversationId: CONV_ID, content: "Hello" }, USER_ID);

    expect(insertAssistantChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: USER_ID,
        conversation_id: CONV_ID,
        role: "assistant",
        content: "Hi there!",
      }),
    );
  });

  it("persists tool_calls and tool_results when the loop produced any", async () => {
    mockRunChatToolLoop.mockResolvedValue({
      text: "Here is what I found.",
      inputTokens: 20,
      outputTokens: 40,
      toolCalls: [{ id: "call-1", tool: "web_fetch", args: { url: "https://example.com" } }],
      toolResults: [{ callId: "call-1", tool: "web_fetch", result: { text: "hello" } }],
    });

    await handleChatSend({ conversationId: CONV_ID, content: "Fetch example.com" }, USER_ID);

    expect(insertAssistantChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_calls: [expect.objectContaining({ tool: "web_fetch" })],
        tool_results: [expect.objectContaining({ callId: "call-1" })],
      }),
    );
  });

  it("auto-renames thread when history has exactly the new user message and no title", async () => {
    historyChain._result = { data: [{ role: "user", content: "Hello" }], error: null };

    await handleChatSend({ conversationId: CONV_ID, content: "Hello" }, USER_ID);

    expect(mockAutoRenameThread).toHaveBeenCalledWith(CONV_ID, "Hello", USER_ID);
  });

  it("does not auto-rename when conversation already has a title", async () => {
    historyChain._result = { data: [{ role: "user", content: "Hello" }], error: null };
    setupMocks({ convHasTitle: true });

    await handleChatSend({ conversationId: CONV_ID, content: "Hello" }, USER_ID);

    expect(mockAutoRenameThread).not.toHaveBeenCalled();
  });

  it("updates conversations.updated_at", async () => {
    await handleChatSend({ conversationId: CONV_ID, content: "Hello" }, USER_ID);

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ updated_at: expect.any(String) }),
    );
    expect(updateChain.eq).toHaveBeenCalledWith("id", CONV_ID);
  });

  it("broadcasts chat.messageCreated for both messages via user-scoped channel", async () => {
    await handleChatSend({ conversationId: CONV_ID, content: "Hello" }, USER_ID);

    expect(mockSupabase.channel).toHaveBeenCalledWith(`user:${USER_ID}:events`);

    const calls = (mockChannel.send as any).mock.calls as any[];
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toMatchObject({
      type: "broadcast",
      event: "chat.messageCreated",
      payload: expect.objectContaining({ role: "user", conversationId: CONV_ID }),
    });
    expect(calls[1][0]).toMatchObject({
      type: "broadcast",
      event: "chat.messageCreated",
      payload: expect.objectContaining({ role: "assistant", content: "Hi there!" }),
    });
  });

  it("throws if user message insert fails", async () => {
    insertUserChain.single.mockResolvedValue({ data: null, error: { message: "DB error" } });

    await expect(
      handleChatSend({ conversationId: CONV_ID, content: "Hello" }, USER_ID),
    ).rejects.toThrow("Failed to insert user message");
  });

  it("throws if history load fails", async () => {
    historyChain._result = { data: null, error: { message: "history error" } };

    await expect(
      handleChatSend({ conversationId: CONV_ID, content: "Hello" }, USER_ID),
    ).rejects.toThrow("Failed to load history");
  });
});

describe("handleChatCancel", () => {
  it("returns { cancelled: true }", async () => {
    const result = await handleChatCancel();
    expect(result).toEqual({ cancelled: true });
  });
});

/**
 * Unit tests for worker/src/voice/tool-handler.ts
 *
 * Focus: the whitelist check. A demo visitor in plan mode must not be able
 * to invoke write tools even if the browser fabricates a function_call event
 * for one — the handler has to re-derive the allowed set from the session's
 * permission_mode column and reject anything else.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const VOICE_SESSION_ID = "vs-1";

// ─── Supabase mock ────────────────────────────────────────────────────────────

function makeSessionChain(
  sessionData: {
    id: string;
    user_id: string;
    permission_mode: string;
    status: string;
  } | null,
): any {
  const chain: any = {};
  for (const m of ["from", "select", "eq"]) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain.single = jest
    .fn()
    .mockImplementation(() => Promise.resolve({ data: sessionData, error: sessionData ? null : { message: "not found" } }));
  return chain;
}

const mockSupabase: any = {
  from: jest.fn(),
  rpc: jest
    .fn<() => Promise<{ data: unknown; error: unknown }>>()
    .mockResolvedValue({ data: null, error: null }),
};

jest.unstable_mockModule("../supabase.js", () => ({
  getSupabase: () => mockSupabase,
}));

// ─── Tool executor mock — record calls, return canned result ─────────────────

const mockExecuteToolCall = jest
  .fn<
    (name: string, args: Record<string, unknown>, userId: string) => Promise<unknown>
  >()
  .mockResolvedValue({ ok: true });

jest.unstable_mockModule("../chat/tool-executor.js", () => ({
  executeToolCall: mockExecuteToolCall,
}));

const { handleVoiceToolExecute } = await import("../voice/tool-handler.js");

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

describe("handleVoiceToolExecute — ownership", () => {
  it("throws voice_session_not_found when session is owned by another user", async () => {
    mockSupabase.from.mockReturnValue(makeSessionChain(null));
    await expect(
      handleVoiceToolExecute(
        { voiceSessionId: "vs-other", callId: "call-1", name: "list_goals", arguments: "{}" },
        USER_ID,
      ),
    ).rejects.toThrow("voice_session_not_found");
    expect(mockExecuteToolCall).not.toHaveBeenCalled();
  });

  it("throws voice_session_not_active for ended sessions", async () => {
    mockSupabase.from.mockReturnValue(
      makeSessionChain({
        id: VOICE_SESSION_ID,
        user_id: USER_ID,
        permission_mode: "plan",
        status: "ended",
      }),
    );
    await expect(
      handleVoiceToolExecute(
        { voiceSessionId: VOICE_SESSION_ID, callId: "call-1", name: "list_goals", arguments: "{}" },
        USER_ID,
      ),
    ).rejects.toThrow("voice_session_not_active");
    expect(mockExecuteToolCall).not.toHaveBeenCalled();
  });
});

describe("handleVoiceToolExecute — whitelist", () => {
  beforeEach(() => {
    mockSupabase.from.mockReturnValue(
      makeSessionChain({
        id: VOICE_SESSION_ID,
        user_id: USER_ID,
        permission_mode: "plan", // read-only
        status: "active",
      }),
    );
  });

  it("permits a read tool under plan mode", async () => {
    mockExecuteToolCall.mockResolvedValueOnce({ goals: [] });
    const result = await handleVoiceToolExecute(
      { voiceSessionId: VOICE_SESSION_ID, callId: "call-read", name: "list_goals", arguments: "{}" },
      USER_ID,
    );
    expect(result.callId).toBe("call-read");
    expect(result.result).toEqual({ goals: [] });
    expect(mockExecuteToolCall).toHaveBeenCalledWith("list_goals", {}, USER_ID);
  });

  it("REJECTS a write tool under plan mode even if browser requests it", async () => {
    await expect(
      handleVoiceToolExecute(
        {
          voiceSessionId: VOICE_SESSION_ID,
          callId: "call-write",
          name: "create_goal",
          arguments: JSON.stringify({ projectId: "p1", name: "evil goal" }),
        },
        USER_ID,
      ),
    ).rejects.toThrow("voice_tool_not_allowed: create_goal");
    expect(mockExecuteToolCall).not.toHaveBeenCalled();
  });

  it("REJECTS an unknown tool name", async () => {
    await expect(
      handleVoiceToolExecute(
        { voiceSessionId: VOICE_SESSION_ID, callId: "call-unknown", name: "rm_rf_everything", arguments: "{}" },
        USER_ID,
      ),
    ).rejects.toThrow("voice_tool_not_allowed: rm_rf_everything");
    expect(mockExecuteToolCall).not.toHaveBeenCalled();
  });
});

describe("handleVoiceToolExecute — write tools under bypass mode", () => {
  beforeEach(() => {
    mockSupabase.from.mockReturnValue(
      makeSessionChain({
        id: VOICE_SESSION_ID,
        user_id: USER_ID,
        permission_mode: "bypassPermissions",
        status: "active",
      }),
    );
  });

  it("permits create_goal in bypass mode", async () => {
    mockExecuteToolCall.mockResolvedValueOnce({ goal: { id: "g1" } });
    const result = await handleVoiceToolExecute(
      {
        voiceSessionId: VOICE_SESSION_ID,
        callId: "call-1",
        name: "create_goal",
        arguments: JSON.stringify({ projectId: "p1", name: "new goal" }),
      },
      USER_ID,
    );
    expect(result.result).toEqual({ goal: { id: "g1" } });
  });
});

describe("handleVoiceToolExecute — argument parsing", () => {
  beforeEach(() => {
    mockSupabase.from.mockReturnValue(
      makeSessionChain({
        id: VOICE_SESSION_ID,
        user_id: USER_ID,
        permission_mode: "plan",
        status: "active",
      }),
    );
    mockExecuteToolCall.mockResolvedValue({ ok: true });
  });

  it("accepts JSON string arguments", async () => {
    await handleVoiceToolExecute(
      {
        voiceSessionId: VOICE_SESSION_ID,
        callId: "c1",
        name: "list_goals",
        arguments: JSON.stringify({ projectId: "p1" }),
      },
      USER_ID,
    );
    expect(mockExecuteToolCall).toHaveBeenCalledWith("list_goals", { projectId: "p1" }, USER_ID);
  });

  it("accepts pre-parsed object arguments", async () => {
    await handleVoiceToolExecute(
      { voiceSessionId: VOICE_SESSION_ID, callId: "c2", name: "list_goals", arguments: { projectId: "p2" } },
      USER_ID,
    );
    expect(mockExecuteToolCall).toHaveBeenCalledWith("list_goals", { projectId: "p2" }, USER_ID);
  });

  it("throws on invalid JSON string arguments", async () => {
    await expect(
      handleVoiceToolExecute(
        { voiceSessionId: VOICE_SESSION_ID, callId: "c3", name: "list_goals", arguments: "not json{{" },
        USER_ID,
      ),
    ).rejects.toThrow("voice_tool_invalid_arguments_json");
  });

  it("defaults empty-string arguments to {}", async () => {
    await handleVoiceToolExecute(
      { voiceSessionId: VOICE_SESSION_ID, callId: "c4", name: "list_goals", arguments: "" },
      USER_ID,
    );
    expect(mockExecuteToolCall).toHaveBeenCalledWith("list_goals", {}, USER_ID);
  });
});

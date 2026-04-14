/**
 * Unit tests for worker/src/voice/session.ts
 *
 * Mocks Supabase, the voice instructions builder, and global fetch so we
 * can test the full mint-ephemeral-token flow without hitting OpenAI.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const CONV_ID = "conv-voice-1";

// ─── Config mock — provide OPENAI_API_KEY so handler doesn't throw ────────────
jest.unstable_mockModule("../config.js", () => ({
  config: {
    supabaseUrl: "https://test.supabase.co",
    supabaseServiceKey: "test",
    openrouterApiKey: "test",
    openaiApiKey: "sk-openai-test",
    e2bApiKey: "test",
    appUrl: "https://app.test",
  },
}));

// ─── Supabase mock ────────────────────────────────────────────────────────────

function makeChain(result: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: any = {
    _result: result,
    then(fn: (v: unknown) => unknown) {
      return Promise.resolve(chain._result).then(fn);
    },
  };
  for (const m of ["from", "insert", "update", "select", "eq", "maybeSingle", "single"]) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain.single = jest.fn().mockImplementation(() => Promise.resolve(chain._result));
  chain.maybeSingle = jest.fn().mockImplementation(() => Promise.resolve(chain._result));
  return chain;
}

const mockSupabase: any = {
  from: jest.fn(),
  rpc: jest.fn<() => Promise<{ data: unknown; error: unknown }>>().mockResolvedValue({
    data: null,
    error: null,
  }),
};

jest.unstable_mockModule("../supabase.js", () => ({
  getSupabase: () => mockSupabase,
}));

// ─── Voice instructions mock ──────────────────────────────────────────────────

jest.unstable_mockModule("../voice/instructions.js", () => ({
  buildVoiceInstructions: jest
    .fn<() => Promise<string>>()
    .mockResolvedValue("You are voice-mode assistant. Be concise."),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

const { handleVoiceSessionStart, handleVoiceSessionEnd } = await import("../voice/session.js");
const { DemoRateLimitError } = await import("../demo-rate-limit.js");

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

const originalFetch = global.fetch;

function mockFetchOnce(body: unknown, status = 200): void {
  global.fetch = jest
    .fn<(input: unknown, init?: unknown) => Promise<Response>>()
    .mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response);
}

// ─── Test data ────────────────────────────────────────────────────────────────

const ctx = {
  authUserId: USER_ID,
  isAnonymous: false,
  clientIpHash: "ip-hash-xyz",
};

const ephemeralResponse = {
  value: "ek_test_ephemeral_token",
  expires_at: Math.floor(Date.now() / 1000) + 120,
  session: { id: "sess_openai_test" },
};

// ─── Reset between tests ──────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // The handler calls: insert voice_sessions, then update (after mint).
  // We return a single chain that no-ops its UPDATE and resolves INSERT.
  const chain = makeChain({ data: null, error: null });
  mockSupabase.from.mockReturnValue(chain);
  global.fetch = originalFetch;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("handleVoiceSessionStart", () => {
  it("mints an ephemeral token and returns session details", async () => {
    mockFetchOnce(ephemeralResponse);

    const result = await handleVoiceSessionStart(
      { conversationId: CONV_ID, voice: "marin" },
      ctx,
    );

    expect(result.ephemeralToken).toBe("ek_test_ephemeral_token");
    expect(result.model).toBe("gpt-realtime-mini"); // default
    expect(result.voice).toBe("marin");
    expect(result.openaiSessionId).toBe("sess_openai_test");
    expect(result.voiceSessionId).toBeTruthy();

    // Verify the OpenAI endpoint was called with the right headers + body
    const fetchCall = (global.fetch as unknown as jest.Mock).mock.calls[0];
    expect(fetchCall[0]).toBe("https://api.openai.com/v1/realtime/client_secrets");
    const init = fetchCall[1] as { headers: Record<string, string>; body: string };
    expect(init.headers.Authorization).toBe("Bearer sk-openai-test");

    const parsedBody = JSON.parse(init.body);
    expect(parsedBody.session.model).toBe("gpt-realtime-mini");
    expect(parsedBody.session.audio.output.voice).toBe("marin");
    expect(parsedBody.session.audio.input.turn_detection.type).toBe("semantic_vad");
    expect(parsedBody.session.audio.input.format.type).toBe("audio/pcm");
    expect(parsedBody.session.output_modalities).toEqual(["audio"]);
    expect(Array.isArray(parsedBody.session.tools)).toBe(true);
    expect(parsedBody.session.tools[0].type).toBe("function");
  });

  it("defaults to gpt-realtime-mini when model is unrecognised", async () => {
    mockFetchOnce(ephemeralResponse);
    const result = await handleVoiceSessionStart(
      { conversationId: CONV_ID, model: "gpt-realtime-ultra" as any },
      ctx,
    );
    expect(result.model).toBe("gpt-realtime-mini");
  });

  it("honours model=gpt-realtime when explicitly requested", async () => {
    mockFetchOnce(ephemeralResponse);
    const result = await handleVoiceSessionStart(
      { conversationId: CONV_ID, model: "gpt-realtime" },
      ctx,
    );
    expect(result.model).toBe("gpt-realtime");
  });

  it("rejects unsupported voice and falls back to marin", async () => {
    mockFetchOnce(ephemeralResponse);
    const result = await handleVoiceSessionStart(
      { conversationId: CONV_ID, voice: "not-a-real-voice" as any },
      ctx,
    );
    expect(result.voice).toBe("marin");
  });

  it("forces plan mode for anonymous demo visitors", async () => {
    mockFetchOnce(ephemeralResponse);
    // Demo visitor with fresh budget
    const demoChain = makeChain({ data: { voice_seconds_used: 0 }, error: null });
    mockSupabase.from.mockReturnValue(demoChain);

    const result = await handleVoiceSessionStart(
      { conversationId: CONV_ID, demoSlug: "nike", permissionMode: "bypassPermissions" },
      { ...ctx, isAnonymous: true },
    );

    expect(result.secondsRemaining).toBe(60);
    // The permissionMode passed by the caller should have been overridden.
    // We can't inspect the instructions mock directly, but we can check
    // that the fetch body contains the plan-mode (read-only) tool set.
    const fetchCall = (global.fetch as unknown as jest.Mock).mock.calls[0];
    const parsedBody = JSON.parse((fetchCall[1] as { body: string }).body);
    const toolNames = parsedBody.session.tools.map((t: { name: string }) => t.name);
    // plan mode allows reads only — no create_goal/archive_*/create_job
    expect(toolNames).not.toContain("create_goal");
    expect(toolNames).not.toContain("archive_goal");
    expect(toolNames).toContain("list_goals");
  });

  it("throws DemoRateLimitError when demo voice budget is exhausted", async () => {
    // No fetch mock — we shouldn't get that far
    const demoChain = makeChain({ data: { voice_seconds_used: 60 }, error: null });
    mockSupabase.from.mockReturnValue(demoChain);

    await expect(
      handleVoiceSessionStart(
        { conversationId: CONV_ID, demoSlug: "nike" },
        { ...ctx, isAnonymous: true },
      ),
    ).rejects.toBeInstanceOf(DemoRateLimitError);
  });

  it("rejects anonymous sessions without a demoSlug", async () => {
    await expect(
      handleVoiceSessionStart({ conversationId: CONV_ID }, { ...ctx, isAnonymous: true }),
    ).rejects.toThrow("voice_requires_demo_slug");
  });

  it("surfaces OpenAI errors cleanly", async () => {
    mockFetchOnce({ error: { message: "Invalid model" } }, 400);
    await expect(
      handleVoiceSessionStart({ conversationId: CONV_ID }, ctx),
    ).rejects.toThrow(/openai_client_secret_failed: HTTP 400/);
  });

  it("throws a clear error if OPENAI_API_KEY is unset", async () => {
    // Replace the config mock for this test only
    jest.resetModules();
    jest.unstable_mockModule("../config.js", () => ({
      config: { openaiApiKey: "" },
    }));
    const { handleVoiceSessionStart: handler } = await import("../voice/session.js");
    await expect(
      handler({ conversationId: CONV_ID }, ctx),
    ).rejects.toThrow("voice_not_configured");
  });
});

describe("handleVoiceSessionEnd", () => {
  it("marks the session as ended and records demo seconds for anonymous users", async () => {
    const sessionChain = makeChain({
      data: { id: "vs-1", user_id: USER_ID, permission_mode: "plan" },
      error: null,
    });
    mockSupabase.from.mockReturnValue(sessionChain);
    mockSupabase.rpc.mockResolvedValueOnce({ data: 45, error: null });

    await handleVoiceSessionEnd(
      { voiceSessionId: "vs-1", elapsedSeconds: 45, demoSlug: "nike" },
      { ...ctx, isAnonymous: true },
    );

    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      "increment_demo_voice_seconds",
      expect.objectContaining({ p_seconds: 45, p_slug: "nike" }),
    );
  });

  it("does not record demo seconds for authenticated users", async () => {
    const sessionChain = makeChain({
      data: { id: "vs-1", user_id: USER_ID, permission_mode: "plan" },
      error: null,
    });
    mockSupabase.from.mockReturnValue(sessionChain);

    await handleVoiceSessionEnd({ voiceSessionId: "vs-1", elapsedSeconds: 120 }, ctx);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it("throws voice_session_not_found when the session belongs to another user", async () => {
    const sessionChain = makeChain({ data: null, error: { message: "no rows" } });
    mockSupabase.from.mockReturnValue(sessionChain);
    await expect(
      handleVoiceSessionEnd({ voiceSessionId: "vs-other" }, ctx),
    ).rejects.toThrow("voice_session_not_found");
  });
});

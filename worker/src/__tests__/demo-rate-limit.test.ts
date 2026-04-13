/**
 * Unit tests for demo-rate-limit.ts
 *
 * Mocks Supabase to exercise the three rate-limit layers (global budget,
 * per-session cap, per-IP daily cap) without any real DB roundtrip.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ─── Mock Supabase ────────────────────────────────────────────────────────────

type MaybeSingleResult = { data: unknown; error: unknown };
type SelectResult = { data: Array<{ messages_sent: number }> | null; error: unknown };

let budgetRow: MaybeSingleResult = { data: null, error: null };
let sessionRow: MaybeSingleResult = { data: null, error: null };
let ipRowsResult: SelectResult = { data: [], error: null };
let sessionIncrementCalls = 0;
let budgetIncrementCalls = 0;

function makeMockSupabase(): any {
  // Handles .from(table).select(cols).eq(...).maybeSingle() and the IP aggregate
  // query .from(table).select(cols).eq(...).gte(...)
  return {
    from(table: string) {
      return {
        select: (_cols: string) => {
          const chain: any = {};
          chain.eq = (_col: string, _val: unknown) => chain;
          chain.gte = (_col: string, _val: unknown) => {
            if (table === "demo_rate_limits") return Promise.resolve(ipRowsResult);
            return chain;
          };
          chain.maybeSingle = async () => {
            if (table === "demo_daily_budget") return budgetRow;
            if (table === "demo_rate_limits")  return sessionRow;
            return { data: null, error: null };
          };
          return chain;
        },
      };
    },
    rpc: async (fn: string, _args: unknown) => {
      if (fn === "increment_demo_session") sessionIncrementCalls++;
      if (fn === "increment_demo_budget") budgetIncrementCalls++;
      return { data: 1, error: null };
    },
  };
}

const mockSupabase = makeMockSupabase();

jest.unstable_mockModule("../supabase.js", () => ({
  getSupabase: () => mockSupabase,
}));

const {
  checkDemoRateLimit,
  recordDemoMessage,
  hashIp,
  extractClientIp,
  DEMO_PER_SESSION_CAP,
  DEMO_PER_IP_DAILY_CAP,
  DEMO_GLOBAL_DAILY_BUDGET_USD,
} = await import("../demo-rate-limit.js");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("hashIp", () => {
  it("produces a stable hex string for the same input", () => {
    const a = hashIp("1.2.3.4");
    const b = hashIp("1.2.3.4");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("different IPs produce different hashes", () => {
    expect(hashIp("1.2.3.4")).not.toBe(hashIp("5.6.7.8"));
  });

  it("null / undefined / empty collapse into a sentinel bucket", () => {
    expect(hashIp(null)).toBe(hashIp(undefined));
    expect(hashIp("")).toBe(hashIp(undefined));
  });
});

describe("extractClientIp", () => {
  it("picks the first IP from X-Forwarded-For", () => {
    expect(extractClientIp("1.2.3.4, 10.0.0.1, 10.0.0.2")).toBe("1.2.3.4");
  });

  it("returns null for missing / empty header", () => {
    expect(extractClientIp(undefined)).toBeNull();
    expect(extractClientIp("")).toBeNull();
  });

  it("trims whitespace around the first entry", () => {
    expect(extractClientIp("  1.2.3.4  , 10.0.0.1")).toBe("1.2.3.4");
  });
});

describe("checkDemoRateLimit", () => {
  beforeEach(() => {
    budgetRow = { data: null, error: null };
    sessionRow = { data: null, error: null };
    ipRowsResult = { data: [], error: null };
  });

  it("ok when no budget / session / IP history exists", async () => {
    const result = await checkDemoRateLimit({
      sessionId: "sess-1",
      ipHash: "h1",
      slug: "nike",
    });
    expect(result.ok).toBe(true);
  });

  it("blocks when the global daily budget is exhausted", async () => {
    budgetRow = { data: { cost_usd: DEMO_GLOBAL_DAILY_BUDGET_USD + 0.01 }, error: null };
    const result = await checkDemoRateLimit({ sessionId: "s", ipHash: "h", slug: "nike" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("global_budget_exceeded");
  });

  it("blocks when the per-session cap is reached", async () => {
    sessionRow = { data: { messages_sent: DEMO_PER_SESSION_CAP }, error: null };
    const result = await checkDemoRateLimit({ sessionId: "s", ipHash: "h", slug: "nike" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("session_cap_reached");
  });

  it("blocks when the per-IP daily cap is exceeded across sessions", async () => {
    ipRowsResult = {
      data: Array.from({ length: 3 }, () => ({ messages_sent: Math.ceil(DEMO_PER_IP_DAILY_CAP / 3) + 1 })),
      error: null,
    };
    const result = await checkDemoRateLimit({ sessionId: "s-new", ipHash: "h", slug: "nike" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ip_cap_reached");
  });

  it("allows sessions below the per-session cap", async () => {
    sessionRow = { data: { messages_sent: DEMO_PER_SESSION_CAP - 1 }, error: null };
    const result = await checkDemoRateLimit({ sessionId: "s", ipHash: "h", slug: "nike" });
    expect(result.ok).toBe(true);
  });

  it("short-circuits budget check before session check", async () => {
    budgetRow = { data: { cost_usd: DEMO_GLOBAL_DAILY_BUDGET_USD + 1 }, error: null };
    sessionRow = { data: { messages_sent: 0 }, error: null };
    const result = await checkDemoRateLimit({ sessionId: "s", ipHash: "h", slug: "nike" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("global_budget_exceeded");
  });
});

describe("recordDemoMessage", () => {
  beforeEach(() => {
    sessionIncrementCalls = 0;
    budgetIncrementCalls = 0;
  });

  it("calls both increment RPCs once", async () => {
    await recordDemoMessage({
      sessionId: "s",
      ipHash: "h",
      slug: "nike",
      costUsd: 0.002,
    });
    expect(sessionIncrementCalls).toBe(1);
    expect(budgetIncrementCalls).toBe(1);
  });
});

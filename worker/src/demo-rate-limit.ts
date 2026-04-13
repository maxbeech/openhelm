/**
 * Demo chat rate limiting.
 *
 * Three layers, checked in this order:
 *   1. Global daily USD budget — hard ceiling across ALL demo chat traffic.
 *      Protects against botnets / abuse (bounded maximum monthly cost).
 *   2. Per-session quota — each anonymous Supabase session gets a fixed
 *      number of messages before the signup modal kicks in. The usual
 *      conversion moment.
 *   3. Per-IP daily cap — catches users who clear localStorage / open new
 *      tabs to reset their session quota. Hashed, not stored raw.
 *
 * Layered in this order because the cheapest check (single row by primary
 * key) comes first and short-circuits the more expensive COUNT query.
 *
 * The rate-limit state tables live in Supabase (see migration
 * 20260414000003_demo_rate_limits.sql) and are only written via
 * SECURITY DEFINER RPCs — never touched by user JWTs.
 */

import { createHash } from "node:crypto";
import { getSupabase } from "./supabase.js";

// ─── Tunables ────────────────────────────────────────────────────────────────

/** Messages allowed per anonymous Supabase session (per demo slug). */
export const DEMO_PER_SESSION_CAP = 10;

/** Messages allowed per IP across all sessions in a rolling 24h window. */
export const DEMO_PER_IP_DAILY_CAP = 50;

/** Hard $ ceiling across all demo chat users per UTC day. */
export const DEMO_GLOBAL_DAILY_BUDGET_USD = 20;

// ─── Public API ──────────────────────────────────────────────────────────────

export type RateLimitResult =
  | { ok: true }
  | { ok: false; reason: DemoRateLimitReason };

export type DemoRateLimitReason =
  | "global_budget_exceeded"
  | "session_cap_reached"
  | "ip_cap_reached";

export class DemoRateLimitError extends Error {
  readonly isDemoRateLimit = true;
  readonly reason: DemoRateLimitReason;

  constructor(reason: DemoRateLimitReason) {
    super(`demo rate limit: ${reason}`);
    this.name = "DemoRateLimitError";
    this.reason = reason;
  }
}

/**
 * Hash an IP address for persistent storage. Falls back to a sentinel if
 * no IP can be extracted — this keeps the schema non-null and still groups
 * the "unknown IP" traffic into one bucket for the daily cap.
 */
export function hashIp(rawIp: string | null | undefined): string {
  const secret = process.env.DEMO_IP_HASH_SECRET ?? "openhelm-demo-dev-secret";
  const input = (rawIp ?? "unknown").trim() || "unknown";
  return createHash("sha256").update(`${input}:${secret}`).digest("hex");
}

/** Extract the first IP from X-Forwarded-For, or null if header absent. */
export function extractClientIp(xForwardedFor: string | undefined): string | null {
  if (!xForwardedFor) return null;
  const first = xForwardedFor.split(",")[0]?.trim();
  return first || null;
}

/**
 * Check whether a demo visitor is allowed to send another chat message.
 * Does NOT record the attempt — call recordDemoMessage() after the LLM
 * call succeeds so that failed calls don't eat a message credit.
 */
export async function checkDemoRateLimit(opts: {
  sessionId: string;
  ipHash: string;
  slug: string;
}): Promise<RateLimitResult> {
  const supabase = getSupabase();
  const today = todayUtc();

  // 1. Global daily budget
  const { data: budget } = await supabase
    .from("demo_daily_budget")
    .select("cost_usd")
    .eq("day", today)
    .maybeSingle();
  if (budget && Number(budget.cost_usd) >= DEMO_GLOBAL_DAILY_BUDGET_USD) {
    return { ok: false, reason: "global_budget_exceeded" };
  }

  // 2. Per-session cap
  const { data: session } = await supabase
    .from("demo_rate_limits")
    .select("messages_sent")
    .eq("session_id", opts.sessionId)
    .eq("slug", opts.slug)
    .maybeSingle();
  if (session && Number(session.messages_sent) >= DEMO_PER_SESSION_CAP) {
    return { ok: false, reason: "session_cap_reached" };
  }

  // 3. Per-IP daily cap — rolling 24h window
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { data: ipRows } = await supabase
    .from("demo_rate_limits")
    .select("messages_sent")
    .eq("ip_hash", opts.ipHash)
    .gte("created_at", since);

  const ipTotal = (ipRows ?? []).reduce(
    (sum: number, row: { messages_sent: number }) => sum + Number(row.messages_sent ?? 0),
    0,
  );
  if (ipTotal >= DEMO_PER_IP_DAILY_CAP) {
    return { ok: false, reason: "ip_cap_reached" };
  }

  return { ok: true };
}

/**
 * Record a successful demo chat message. Uses SECURITY DEFINER RPCs that
 * do atomic UPSERT + increment — safe under concurrent traffic.
 */
export async function recordDemoMessage(opts: {
  sessionId: string;
  ipHash: string;
  slug: string;
  costUsd: number;
}): Promise<void> {
  const supabase = getSupabase();
  const { error: sessionErr } = await supabase.rpc("increment_demo_session", {
    p_session_id: opts.sessionId,
    p_ip_hash: opts.ipHash,
    p_slug: opts.slug,
  });
  if (sessionErr) {
    console.error("[demo-rate-limit] increment_demo_session failed:", sessionErr.message);
  }

  const { error: budgetErr } = await supabase.rpc("increment_demo_budget", {
    p_day: todayUtc(),
    p_cost_usd: opts.costUsd,
  });
  if (budgetErr) {
    console.error("[demo-rate-limit] increment_demo_budget failed:", budgetErr.message);
  }
}

function todayUtc(): string {
  return new Date().toISOString().split("T")[0];
}

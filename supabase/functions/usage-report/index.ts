import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * usage-report — Returns current billing period token usage for the authenticated user.
 *
 * Requires: valid Supabase JWT in Authorization header.
 * JWT verification is enforced by Supabase (verify_jwt=true).
 *
 * Response shape:
 * {
 *   plan: 'starter' | 'growth' | 'scale' | null,
 *   status: 'active' | 'past_due' | 'cancelled' | 'trialing' | null,
 *   periodStart: string | null,
 *   periodEnd:   string | null,
 *   includedCredits: number | null,   // Haiku-equivalent tokens included in plan
 *   usedCredits: number,              // Haiku-equivalent tokens consumed this period
 *   remainingCredits: number | null,
 *   breakdown: { execution, planning, chat, assessment },
 *   totalBilledUsd: number,
 * }
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const CALL_TYPES = ["execution", "planning", "chat", "assessment"] as const;
type CallType = (typeof CALL_TYPES)[number];

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });

  try {
    // Fetch subscription
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("plan, status, current_period_start, current_period_end, included_token_credits, used_token_credits")
      .eq("user_id", user.id)
      .maybeSingle();

    // Determine billing window
    const now          = new Date();
    const periodStart  = sub?.current_period_start
      ? new Date(sub.current_period_start)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd    = sub?.current_period_end
      ? new Date(sub.current_period_end)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const { data: records, error: usageError } = await supabase
      .from("usage_records")
      .select("call_type, input_tokens, output_tokens, billed_cost_usd")
      .eq("user_id", user.id)
      .gte("created_at", periodStart.toISOString())
      .lte("created_at", periodEnd.toISOString());

    if (usageError) {
      console.error("[usage-report] Usage query error:", usageError);
      return new Response("Database error", { status: 500, headers: CORS_HEADERS });
    }

    const breakdown = Object.fromEntries(
      CALL_TYPES.map((ct) => [ct, { inputTokens: 0, outputTokens: 0, billedUsd: 0 }]),
    ) as Record<CallType, { inputTokens: number; outputTokens: number; billedUsd: number }>;

    let totalBilledUsd = 0;
    for (const r of records ?? []) {
      const ct = r.call_type as CallType;
      if (breakdown[ct]) {
        breakdown[ct].inputTokens  += r.input_tokens  ?? 0;
        breakdown[ct].outputTokens += r.output_tokens ?? 0;
        breakdown[ct].billedUsd    += Number(r.billed_cost_usd ?? 0);
      }
      totalBilledUsd += Number(r.billed_cost_usd ?? 0);
    }

    const includedCredits = sub ? Number(sub.included_token_credits) : null;
    const usedCredits     = sub ? Number(sub.used_token_credits) : 0;

    return new Response(
      JSON.stringify({
        plan:             sub?.plan ?? null,
        status:           sub?.status ?? null,
        periodStart:      periodStart.toISOString(),
        periodEnd:        periodEnd.toISOString(),
        includedCredits,
        usedCredits,
        remainingCredits: includedCredits != null ? Math.max(0, includedCredits - usedCredits) : null,
        breakdown,
        totalBilledUsd:   Math.round(totalBilledUsd * 1_000_000) / 1_000_000,
      }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[usage-report] Error:", err);
    return new Response("Internal error", { status: 500, headers: CORS_HEADERS });
  }
});

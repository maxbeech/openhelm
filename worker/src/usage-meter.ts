/**
 * Usage Metering — records every LLM token consumption event for billing.
 *
 * All costs are tracked in USD with a 20% markup over raw Anthropic rates.
 * Token credits are normalized to Haiku-equivalent units for consistent billing.
 */

import { getSupabase } from "./supabase.js";
import {
  calculateRawCostUsd,
  toHaikuEquivalentTokens,
  MARKUP,
} from "./cost-calculator.js";

export { calculateRawCostUsd, toHaikuEquivalentTokens } from "./cost-calculator.js";

export type CallType = "execution" | "planning" | "chat" | "assessment";

export interface UsageRecord {
  userId: string;
  runId?: string;
  callType: CallType;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Insert a usage record and atomically increment subscription credits. */
export async function meterUsage(record: UsageRecord): Promise<void> {
  const supabase = getSupabase();

  const rawCostUsd = calculateRawCostUsd(record.model, record.inputTokens, record.outputTokens);
  const billedCostUsd = rawCostUsd * MARKUP;
  const totalTokens = record.inputTokens + record.outputTokens;
  const haikuCredits = toHaikuEquivalentTokens(record.model, totalTokens);

  const { error: insertErr } = await supabase.from("usage_records").insert({
    id: crypto.randomUUID(),
    user_id: record.userId,
    run_id: record.runId ?? null,
    call_type: record.callType,
    model: record.model,
    input_tokens: record.inputTokens,
    output_tokens: record.outputTokens,
    raw_cost_usd: rawCostUsd,
    billed_cost_usd: billedCostUsd,
    created_at: new Date().toISOString(),
  });

  if (insertErr) {
    console.error("[usage-meter] failed to insert usage record:", insertErr.message);
  }

  // Update subscription credit balance via RPC (atomic increment)
  const { error: rpcErr } = await supabase.rpc("increment_used_credits", {
    p_user_id: record.userId,
    p_amount: haikuCredits,
  });

  if (rpcErr) {
    console.error("[usage-meter] failed to increment credits:", rpcErr.message);
  }
}

/**
 * Record usage for a completed run.
 * Token counts are approximated from the model tier since the Worker doesn't
 * have exact counts from the sandbox. For full precision, the Goose stream
 * parser's totalTokens field should be relayed via run_logs and summed here.
 */
export async function meterRunUsage(
  userId: string,
  runId: string,
  model: string,
): Promise<void> {
  // Query summed token counts from run_logs (stored as stream-json by executor)
  // For now, record a usage event without token counts (credits updated when
  // the stream parser extracts counts from Goose's "complete" event).
  await meterUsage({
    userId,
    runId,
    callType: "execution",
    model: model ?? "sonnet",
    inputTokens: 0,
    outputTokens: 0,
  });
}

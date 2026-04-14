/**
 * Usage Metering — records every LLM token consumption event for billing.
 *
 * All costs are tracked in USD with a 20% markup over raw Anthropic rates.
 * Token credits are normalized to Haiku-equivalent units for consistent billing.
 */

import { getSupabase } from "./supabase.js";
import {
  calculateRawCostUsd,
  calculateRealtimeCostUsd,
  toHaikuEquivalentTokens,
  MARKUP,
} from "./cost-calculator.js";

export { calculateRawCostUsd, toHaikuEquivalentTokens } from "./cost-calculator.js";

export type CallType =
  | "execution"
  | "planning"
  | "chat"
  | "assessment"
  | "voice_input"
  | "voice_output";

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

export interface VoiceUsageRecord {
  userId: string;
  voiceSessionId: string;
  model: "gpt-realtime-mini" | "gpt-realtime";
  inputAudioTokens: number;
  cachedInputAudioTokens: number;
  outputAudioTokens: number;
  inputTextTokens: number;
  outputTextTokens: number;
}

/**
 * Record a Realtime voice usage event. Writes two rows to usage_records
 * (one for input, one for output) so the existing per-model/per-call-type
 * dashboards keep working, plus updates running totals on voice_sessions
 * and increments the subscription credit balance once for the combined
 * haiku-equivalent total.
 */
export async function meterVoiceUsage(record: VoiceUsageRecord): Promise<{
  rawCostUsd: number;
  billedCostUsd: number;
}> {
  const supabase = getSupabase();

  // Total uncached input = audio + text. Cached-input discount currently
  // applies only to the audio portion since the Realtime API caches the
  // stable instructions+tools block. Text-token inputs are small and get
  // priced at the uncached rate (negligible impact).
  const totalInput = record.inputAudioTokens + record.inputTextTokens;
  const totalOutput = record.outputAudioTokens + record.outputTextTokens;

  const rawCostUsd = calculateRealtimeCostUsd(
    record.model,
    totalInput,
    record.cachedInputAudioTokens,
    totalOutput,
  );
  const billedCostUsd = rawCostUsd * MARKUP;

  const now = new Date().toISOString();

  // Split the usage_records write: one row per direction keeps call-type
  // breakdowns accurate and makes it easy to surface "voice minutes" later.
  const inputRow = {
    id: crypto.randomUUID(),
    user_id: record.userId,
    run_id: null,
    call_type: "voice_input" as const,
    model: record.model,
    input_tokens: totalInput,
    output_tokens: 0,
    raw_cost_usd: rawCostUsd / 2, // approximate split — exact split recorded on voice_sessions
    billed_cost_usd: billedCostUsd / 2,
    created_at: now,
  };
  const outputRow = {
    id: crypto.randomUUID(),
    user_id: record.userId,
    run_id: null,
    call_type: "voice_output" as const,
    model: record.model,
    input_tokens: 0,
    output_tokens: totalOutput,
    raw_cost_usd: rawCostUsd / 2,
    billed_cost_usd: billedCostUsd / 2,
    created_at: now,
  };

  const { error: insertErr } = await supabase
    .from("usage_records")
    .insert([inputRow, outputRow]);
  if (insertErr) {
    console.error("[usage-meter] voice usage insert failed:", insertErr.message);
  }

  // Update running totals on the voice session itself so the UI cost chip
  // and session-end summary can be served from a single row.
  const { error: updateErr } = await supabase.rpc("increment_voice_session_totals", {
    p_session_id: record.voiceSessionId,
    p_input_audio: record.inputAudioTokens,
    p_cached_input: record.cachedInputAudioTokens,
    p_output_audio: record.outputAudioTokens,
    p_input_text: record.inputTextTokens,
    p_output_text: record.outputTextTokens,
    p_cost_usd: rawCostUsd,
    p_billed_usd: billedCostUsd,
  });
  if (updateErr) {
    // Non-fatal — the RPC will be added in a follow-up migration. For now
    // fall back to a direct update which is slightly racier but correct
    // under low contention (one voice session ≈ one concurrent writer).
    const { data: existing } = await supabase
      .from("voice_sessions")
      .select(
        "total_input_audio_tokens, total_cached_input_tokens, total_output_audio_tokens, total_input_text_tokens, total_output_text_tokens, total_cost_usd, total_billed_usd",
      )
      .eq("id", record.voiceSessionId)
      .single();
    if (existing) {
      await supabase
        .from("voice_sessions")
        .update({
          total_input_audio_tokens:
            (existing.total_input_audio_tokens ?? 0) + record.inputAudioTokens,
          total_cached_input_tokens:
            (existing.total_cached_input_tokens ?? 0) + record.cachedInputAudioTokens,
          total_output_audio_tokens:
            (existing.total_output_audio_tokens ?? 0) + record.outputAudioTokens,
          total_input_text_tokens:
            (existing.total_input_text_tokens ?? 0) + record.inputTextTokens,
          total_output_text_tokens:
            (existing.total_output_text_tokens ?? 0) + record.outputTextTokens,
          total_cost_usd: Number(existing.total_cost_usd ?? 0) + rawCostUsd,
          total_billed_usd: Number(existing.total_billed_usd ?? 0) + billedCostUsd,
        })
        .eq("id", record.voiceSessionId);
    }
  }

  // Increment subscription credits with a single haiku-equivalent total.
  const haikuCredits = toHaikuEquivalentTokens(record.model, totalInput + totalOutput);
  await supabase.rpc("increment_used_credits", {
    p_user_id: record.userId,
    p_amount: haikuCredits,
  });

  return { rawCostUsd, billedCostUsd };
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

/**
 * Voice meter handler — records usage tokens reported by the browser after
 * each Realtime `response.done` event. The browser parses the event's
 * `response.usage` block and posts us the totals; we fan out to
 * usage_records and voice_sessions running totals via meterVoiceUsage().
 */

import { getSupabase } from "../supabase.js";
import { meterVoiceUsage, type VoiceUsageRecord } from "../usage-meter.js";
import type { VoiceModel } from "./session.js";

export interface VoiceMeterReportParams {
  voiceSessionId: string;
  inputAudioTokens: number;
  cachedInputAudioTokens: number;
  outputAudioTokens: number;
  inputTextTokens: number;
  outputTextTokens: number;
}

export interface VoiceMeterReportResult {
  rawCostUsd: number;
  billedCostUsd: number;
  totalCostUsd: number;
  totalBilledUsd: number;
}

export async function handleVoiceMeterReport(
  params: VoiceMeterReportParams,
  userId: string,
): Promise<VoiceMeterReportResult> {
  const supabase = getSupabase();

  // Fetch session to verify ownership and get the model tier.
  const { data: session, error } = await supabase
    .from("voice_sessions")
    .select("id, user_id, model, total_cost_usd, total_billed_usd")
    .eq("id", params.voiceSessionId)
    .eq("user_id", userId)
    .single();

  if (error || !session) {
    throw new Error("voice_session_not_found");
  }

  const record: VoiceUsageRecord = {
    userId,
    voiceSessionId: params.voiceSessionId,
    model: session.model as VoiceModel,
    inputAudioTokens: Math.max(0, Math.floor(params.inputAudioTokens || 0)),
    cachedInputAudioTokens: Math.max(0, Math.floor(params.cachedInputAudioTokens || 0)),
    outputAudioTokens: Math.max(0, Math.floor(params.outputAudioTokens || 0)),
    inputTextTokens: Math.max(0, Math.floor(params.inputTextTokens || 0)),
    outputTextTokens: Math.max(0, Math.floor(params.outputTextTokens || 0)),
  };

  const { rawCostUsd, billedCostUsd } = await meterVoiceUsage(record);

  // Re-read the updated session totals so the frontend cost chip can show
  // the new cumulative number without a second round trip.
  const { data: updated } = await supabase
    .from("voice_sessions")
    .select("total_cost_usd, total_billed_usd")
    .eq("id", params.voiceSessionId)
    .single();

  return {
    rawCostUsd,
    billedCostUsd,
    totalCostUsd: Number(updated?.total_cost_usd ?? 0),
    totalBilledUsd: Number(updated?.total_billed_usd ?? 0),
  };
}

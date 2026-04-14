/**
 * Pure cost calculation functions — no external dependencies.
 * Used by usage-meter.ts and testable without Supabase or env vars.
 *
 * Pricing reflects OpenRouter pass-through costs (as of April 2026).
 * OpenRouter adds a small per-token overhead (<1%) which is not modelled here.
 */

/** Raw provider costs per million tokens */
const RAW_COST_PER_MTOK: Record<string, { input: number; output: number }> = {
  // OpenAI models via OpenRouter (current defaults)
  "openai/gpt-4o-mini": { input: 0.15, output: 0.60 },
  "openai/gpt-4o": { input: 2.50, output: 10.0 },
  "openai/o3": { input: 10.0, output: 40.0 },
  "openai/o4-mini": { input: 1.10, output: 4.40 },
  // Short aliases (used by resolveModel() tier map)
  haiku: { input: 0.15, output: 0.60 },   // maps to gpt-4o-mini
  sonnet: { input: 2.50, output: 10.0 },  // maps to gpt-4o
  opus: { input: 2.50, output: 10.0 },    // maps to gpt-4o (no direct equivalent)
  // Legacy Anthropic model IDs retained for historical usage records
  "claude-haiku-4-5-20251001": { input: 0.25, output: 1.25 },
  "claude-haiku-4-5": { input: 0.25, output: 1.25 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-6": { input: 5.0, output: 25.0 },
  // OpenAI Realtime (direct API, Jan 2026 unified audio/text pricing).
  // Input/output are rolled up here for the text-only path via calculateRawCostUsd.
  // Voice usage uses calculateRealtimeCostUsd below which adds cached-input discount.
  "gpt-realtime": { input: 4.0, output: 16.0 },
  "gpt-realtime-mini": { input: 0.60, output: 2.40 },
};

/**
 * OpenAI Realtime audio+text pricing per million tokens, with cached-input
 * tier for stable instructions/tools (90% discount). Values from the Jan 31,
 * 2026 pricing update — any further changes are single-source-of-truth here.
 */
export const REALTIME_PRICING: Record<
  string,
  { input: number; cachedInput: number; output: number }
> = {
  "gpt-realtime": { input: 4.0, cachedInput: 0.40, output: 16.0 },
  "gpt-realtime-mini": { input: 0.60, cachedInput: 0.06, output: 2.40 },
};

/**
 * Haiku-equivalent multipliers for token credit normalization.
 * 1 credit = 1 gpt-4o-mini token (roughly equivalent to Claude Haiku pricing).
 */
const HAIKU_MULTIPLIER: Record<string, number> = {
  // OpenAI via OpenRouter
  "openai/gpt-4o-mini": 1,
  "openai/gpt-4o": 17,     // $2.50 / $0.15 ≈ 17x
  "openai/o3": 67,         // $10 / $0.15 ≈ 67x
  "openai/o4-mini": 7,     // $1.10 / $0.15 ≈ 7x
  haiku: 1,
  sonnet: 17,
  opus: 17,
  // Legacy Anthropic (historical records)
  "claude-haiku-4-5-20251001": 1,
  "claude-haiku-4-5": 1,
  "claude-sonnet-4-6": 12,
  "claude-opus-4-6": 20,
  // OpenAI Realtime — audio tokens are priced the same as text, so the
  // multiplier is just input price / haiku input price. mini ≈ 4× haiku,
  // flagship ≈ 27× haiku (based on uncached input rates).
  "gpt-realtime-mini": 4,
  "gpt-realtime": 27,
};

export const MARKUP = 1.2; // 20% markup

export function calculateRawCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rates = RAW_COST_PER_MTOK[model] ?? RAW_COST_PER_MTOK.sonnet;
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

export function toHaikuEquivalentTokens(model: string, tokens: number): number {
  const multiplier = HAIKU_MULTIPLIER[model] ?? HAIKU_MULTIPLIER.sonnet;
  return Math.ceil(tokens * multiplier);
}

/**
 * Realtime audio+text cost with the cached-input discount applied to the
 * portion of input tokens that hit the prompt cache. Cached tokens are priced
 * at ~10% of uncached input tokens (the "cachedInput" tier).
 *
 * `inputTokens` is the TOTAL input count (cached + uncached). `cachedInputTokens`
 * is the subset that hit cache and is priced at the cheaper rate. Output and
 * text tokens share the same per-mtok rates as audio.
 */
export function calculateRealtimeCostUsd(
  model: string,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
): number {
  const pricing = REALTIME_PRICING[model] ?? REALTIME_PRICING["gpt-realtime-mini"];
  const uncachedInput = Math.max(inputTokens - cachedInputTokens, 0);
  return (
    (uncachedInput * pricing.input +
      cachedInputTokens * pricing.cachedInput +
      outputTokens * pricing.output) /
    1_000_000
  );
}

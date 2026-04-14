/**
 * Unit tests for usage-meter.ts
 * These tests cover cost calculation and token normalization — no Supabase needed.
 */

import {
  calculateRawCostUsd,
  calculateRealtimeCostUsd,
  toHaikuEquivalentTokens,
} from "../cost-calculator.js";

describe("calculateRawCostUsd", () => {
  it("calculates haiku cost correctly", () => {
    // 1M input @ $0.25 + 1M output @ $1.25 = $1.50
    const cost = calculateRawCostUsd("claude-haiku-4-5-20251001", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(1.5, 4);
  });

  it("calculates sonnet cost correctly", () => {
    // 100K input @ $3/M + 100K output @ $15/M = $0.30 + $1.50 = $1.80
    const cost = calculateRawCostUsd("claude-sonnet-4-6", 100_000, 100_000);
    expect(cost).toBeCloseTo(1.8, 4);
  });

  it("calculates opus cost correctly", () => {
    // 10K input @ $5/M + 10K output @ $25/M = $0.05 + $0.25 = $0.30
    const cost = calculateRawCostUsd("claude-opus-4-6", 10_000, 10_000);
    expect(cost).toBeCloseTo(0.3, 4);
  });

  it("handles shorthand model names (haiku → gpt-4o-mini)", () => {
    // "haiku" shorthand maps to openai/gpt-4o-mini ($0.15/MTok input)
    const haikuShort = calculateRawCostUsd("haiku", 1_000_000, 0);
    const gpt4oMini = calculateRawCostUsd("openai/gpt-4o-mini", 1_000_000, 0);
    expect(haikuShort).toBeCloseTo(gpt4oMini, 6);
  });

  it("falls back to sonnet pricing for unknown models", () => {
    const unknown = calculateRawCostUsd("unknown-model", 1_000_000, 1_000_000);
    const sonnet = calculateRawCostUsd("sonnet", 1_000_000, 1_000_000);
    expect(unknown).toBeCloseTo(sonnet, 6);
  });

  it("returns 0 for zero tokens", () => {
    expect(calculateRawCostUsd("claude-sonnet-4-6", 0, 0)).toBe(0);
  });
});

describe("toHaikuEquivalentTokens", () => {
  it("haiku tokens are 1:1", () => {
    expect(toHaikuEquivalentTokens("claude-haiku-4-5-20251001", 1000)).toBe(1000);
    expect(toHaikuEquivalentTokens("haiku", 500)).toBe(500);
  });

  it("claude-sonnet tokens are 12x haiku equivalent (legacy records)", () => {
    expect(toHaikuEquivalentTokens("claude-sonnet-4-6", 100)).toBe(1200);
  });

  it("claude-opus tokens are 20x haiku equivalent (legacy records)", () => {
    expect(toHaikuEquivalentTokens("claude-opus-4-6", 100)).toBe(2000);
  });

  it("gpt-4o tokens are 17x haiku equivalent", () => {
    expect(toHaikuEquivalentTokens("openai/gpt-4o", 100)).toBe(1700);
    expect(toHaikuEquivalentTokens("sonnet", 100)).toBe(1700); // sonnet shorthand → gpt-4o
  });

  it("rounds up fractional equivalents", () => {
    // 1 gpt-4o-mini token = 1 haiku-equivalent; ceil(1) = 1
    expect(toHaikuEquivalentTokens("openai/gpt-4o-mini", 1)).toBe(1);
  });

  it("realtime-mini tokens are 4x haiku equivalent", () => {
    expect(toHaikuEquivalentTokens("gpt-realtime-mini", 100)).toBe(400);
  });

  it("realtime flagship tokens are 27x haiku equivalent", () => {
    expect(toHaikuEquivalentTokens("gpt-realtime", 100)).toBe(2700);
  });
});

describe("calculateRealtimeCostUsd", () => {
  it("prices gpt-realtime-mini input at $0.60/MTok and output at $2.40/MTok", () => {
    // 1M uncached input + 1M output = $0.60 + $2.40 = $3.00
    const cost = calculateRealtimeCostUsd("gpt-realtime-mini", 1_000_000, 0, 1_000_000);
    expect(cost).toBeCloseTo(3.0, 4);
  });

  it("applies 90% cached-input discount on the cached portion", () => {
    // 1M total input, half cached: 500K @ $0.60 + 500K @ $0.06 = $0.30 + $0.03 = $0.33
    const cost = calculateRealtimeCostUsd("gpt-realtime-mini", 1_000_000, 500_000, 0);
    expect(cost).toBeCloseTo(0.33, 4);
  });

  it("prices gpt-realtime flagship at $4.00 input / $16.00 output per MTok", () => {
    // 100K uncached input + 100K output = $0.40 + $1.60 = $2.00
    const cost = calculateRealtimeCostUsd("gpt-realtime", 100_000, 0, 100_000);
    expect(cost).toBeCloseTo(2.0, 4);
  });

  it("clamps negative uncached tokens to zero when cache > input", () => {
    // Edge: if somehow cachedInput > inputTokens (reporting bug), do not
    // credit the user — just price everything as cached.
    const cost = calculateRealtimeCostUsd("gpt-realtime-mini", 100, 200, 0);
    // 0 uncached @ $0.60 + 200 @ $0.06 per MTok = 200 * 0.06 / 1M = 0.000012
    expect(cost).toBeCloseTo(0.000012, 8);
  });

  it("falls back to mini pricing for unknown realtime model", () => {
    const unknown = calculateRealtimeCostUsd("gpt-realtime-ultra", 1_000_000, 0, 0);
    const mini = calculateRealtimeCostUsd("gpt-realtime-mini", 1_000_000, 0, 0);
    expect(unknown).toBeCloseTo(mini, 6);
  });
});

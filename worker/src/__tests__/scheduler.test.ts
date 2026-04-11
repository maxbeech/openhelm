/**
 * Unit tests for scheduler helpers.
 * Tests the schedule computation logic without hitting Supabase.
 */

import { computeNextFireAt } from "../schedule.js";

describe("computeNextFireAt", () => {
  it("returns null for once schedule", () => {
    expect(computeNextFireAt("once", {})).toBeNull();
  });

  it("returns null for manual schedule", () => {
    expect(computeNextFireAt("manual", {})).toBeNull();
  });

  it("computes interval in minutes", () => {
    const before = Date.now();
    const next = computeNextFireAt("interval", { value: 5, unit: "minutes" });
    const after = Date.now();
    expect(next).not.toBeNull();
    const nextMs = new Date(next!).getTime();
    expect(nextMs).toBeGreaterThanOrEqual(before + 5 * 60_000 - 100);
    expect(nextMs).toBeLessThanOrEqual(after + 5 * 60_000 + 100);
  });

  it("computes interval in hours", () => {
    const before = Date.now();
    const next = computeNextFireAt("interval", { value: 2, unit: "hours" });
    const nextMs = new Date(next!).getTime();
    expect(nextMs).toBeGreaterThanOrEqual(before + 2 * 3_600_000 - 100);
  });

  it("computes interval in days", () => {
    const before = Date.now();
    const next = computeNextFireAt("interval", { value: 1, unit: "days" });
    const nextMs = new Date(next!).getTime();
    expect(nextMs).toBeGreaterThanOrEqual(before + 86_400_000 - 100);
  });

  it("returns null for interval with missing value", () => {
    expect(computeNextFireAt("interval", {})).toBeNull();
  });

  it("returns next minute for cron schedule", () => {
    const before = Date.now();
    const next = computeNextFireAt("cron", { expression: "* * * * *" });
    expect(next).not.toBeNull();
    const nextMs = new Date(next!).getTime();
    expect(nextMs).toBeGreaterThan(before);
  });

  it("returns null for cron with missing expression", () => {
    expect(computeNextFireAt("cron", {})).toBeNull();
  });

  it("returns calendar next_at value", () => {
    const target = "2026-06-01T12:00:00Z";
    const next = computeNextFireAt("calendar", { next_at: target });
    expect(next).toBe(target);
  });

  it("returns null for unknown schedule type", () => {
    expect(computeNextFireAt("unknown", {})).toBeNull();
  });
});

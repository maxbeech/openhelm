import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { RateLimitThrottle } from "../src/executor/rate-limit-throttle.js";

describe("RateLimitThrottle", () => {
  let throttle: RateLimitThrottle;

  beforeEach(() => {
    throttle = new RateLimitThrottle();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("utilization-based delay", () => {
    it("returns 0 when no utilization recorded", () => {
      expect(throttle.getDelayMs()).toBe(0);
    });

    it("returns 0 for utilization below 0.70", () => {
      throttle.recordUtilization(0.5);
      expect(throttle.getDelayMs()).toBe(0);
    });

    it("returns 15s for utilization 0.70–0.80", () => {
      throttle.recordUtilization(0.75);
      expect(throttle.getDelayMs()).toBe(15_000);
    });

    it("returns 45s for utilization 0.80–0.87", () => {
      throttle.recordUtilization(0.83);
      expect(throttle.getDelayMs()).toBe(45_000);
    });

    it("returns 120s for utilization 0.87–0.95", () => {
      throttle.recordUtilization(0.90);
      expect(throttle.getDelayMs()).toBe(120_000);
    });

    it("returns 300s for utilization >= 0.95", () => {
      throttle.recordUtilization(0.97);
      expect(throttle.getDelayMs()).toBe(300_000);
    });

    it("returns 0 when utilization data is stale (>10 min)", () => {
      throttle.recordUtilization(0.95);
      // Advance 11 minutes
      vi.advanceTimersByTime(11 * 60_000);
      expect(throttle.getDelayMs()).toBe(0);
      expect(throttle.utilization).toBe(0);
    });

    it("updates utilization on subsequent calls", () => {
      throttle.recordUtilization(0.95);
      expect(throttle.getDelayMs()).toBe(300_000);
      throttle.recordUtilization(0.60);
      expect(throttle.getDelayMs()).toBe(0);
    });
  });

  describe("error-based backoff", () => {
    it("returns 0 with no errors", () => {
      expect(throttle.getDelayMs()).toBe(0);
    });

    it("returns 30s after 1st error", () => {
      throttle.recordError();
      expect(throttle.getDelayMs()).toBe(30_000);
    });

    it("returns 60s after 2nd error", () => {
      throttle.recordError();
      throttle.recordError();
      expect(throttle.getDelayMs()).toBe(60_000);
    });

    it("returns 120s after 3rd error", () => {
      for (let i = 0; i < 3; i++) throttle.recordError();
      expect(throttle.getDelayMs()).toBe(120_000);
    });

    it("caps at 240s", () => {
      for (let i = 0; i < 10; i++) throttle.recordError();
      expect(throttle.getDelayMs()).toBe(240_000);
    });

    it("resets on resetErrors()", () => {
      throttle.recordError();
      throttle.recordError();
      expect(throttle.getDelayMs()).toBe(60_000);
      throttle.resetErrors();
      expect(throttle.getDelayMs()).toBe(0);
      expect(throttle.errorCount).toBe(0);
    });
  });

  describe("combined signals", () => {
    it("returns the max of utilization and error delays", () => {
      throttle.recordUtilization(0.75); // 15s
      throttle.recordError();           // 30s
      expect(throttle.getDelayMs()).toBe(30_000); // max(15k, 30k)
    });

    it("utilization wins when higher", () => {
      throttle.recordUtilization(0.95); // 300s
      throttle.recordError();           // 30s
      expect(throttle.getDelayMs()).toBe(300_000); // max(300k, 30k)
    });
  });
});

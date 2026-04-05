import { describe, it, expect } from "vitest";
import { computeTierBoundaries, getTierForImportance } from "../../shared/src/inbox-tiering.js";

describe("inbox-tiering", () => {
  describe("computeTierBoundaries", () => {
    it("returns empty boundaries for empty input", () => {
      const result = computeTierBoundaries([]);
      expect(result.boundaries).toEqual([]);
      expect(result.labels).toHaveLength(1);
    });

    it("returns 1 tier for <= 3 events", () => {
      const result = computeTierBoundaries([90, 50, 30]);
      expect(result.boundaries).toEqual([]);
      expect(result.labels).toHaveLength(1);
    });

    it("returns 2 tiers for 4-10 events with natural gap", () => {
      const result = computeTierBoundaries([90, 85, 80, 40, 35, 30]);
      expect(result.boundaries.length).toBeGreaterThanOrEqual(1);
      // There's a natural gap between 80 and 40, so boundary should be around 40
      expect(result.boundaries[0]).toBeLessThanOrEqual(50);
    });

    it("uses quantile fallback for uniform distribution", () => {
      // All values within 4 points of each other — no natural gaps >= 5
      const result = computeTierBoundaries([52, 51, 50, 49, 48, 47, 46, 45, 44, 43, 42]);
      // Should still produce tiers via quantile split
      expect(result.boundaries.length).toBeGreaterThanOrEqual(1);
    });

    it("respects custom config", () => {
      const result = computeTierBoundaries(
        [90, 80, 70, 60, 50, 40, 30, 20, 10],
        { targetTierCount: 3, minGap: 8 },
      );
      expect(result.boundaries.length).toBeLessThanOrEqual(2);
    });

    it("handles all same importance values", () => {
      const result = computeTierBoundaries([50, 50, 50, 50, 50]);
      // Should produce 1 tier (no gaps to split on)
      expect(result.labels.length).toBeGreaterThanOrEqual(1);
    });

    it("handles large clusters with gaps", () => {
      // Cluster 1: 90-100, Cluster 2: 40-50, Cluster 3: 5-15
      const importances = [
        100, 98, 95, 92, 90,
        50, 48, 45, 42, 40,
        15, 12, 10, 8, 5,
      ];
      const result = computeTierBoundaries(importances, { targetTierCount: 3, minGap: 5 });
      // Should find the two natural gaps (~90→50, ~40→15)
      expect(result.boundaries.length).toBe(2);
    });
  });

  describe("getTierForImportance", () => {
    it("returns 0 for importance above highest boundary", () => {
      expect(getTierForImportance(90, [80, 50, 20])).toBe(0);
    });

    it("returns correct tier for value at boundary", () => {
      expect(getTierForImportance(80, [80, 50, 20])).toBe(0);
      expect(getTierForImportance(50, [80, 50, 20])).toBe(1);
      expect(getTierForImportance(20, [80, 50, 20])).toBe(2);
    });

    it("returns last tier for importance below all boundaries", () => {
      expect(getTierForImportance(10, [80, 50, 20])).toBe(3);
    });

    it("handles empty boundaries", () => {
      expect(getTierForImportance(50, [])).toBe(0);
    });
  });
});

import { describe, it, expect } from "vitest";
import { getBaseImportance, computeImportance } from "../src/ipc/inbox-scoring.js";

describe("inbox-scoring", () => {
  describe("getBaseImportance", () => {
    it("returns correct base for known keys", () => {
      expect(getBaseImportance("alert.permanent_failure")).toBe(90);
      expect(getBaseImportance("run.started")).toBe(25);
      expect(getBaseImportance("memory.created")).toBe(20);
      expect(getBaseImportance("chat.assistant_message")).toBe(50);
    });

    it("returns 50 for unknown keys", () => {
      expect(getBaseImportance("unknown.event")).toBe(50);
    });
  });

  describe("computeImportance", () => {
    it("returns base when no modifiers", () => {
      expect(computeImportance(50)).toBe(50);
    });

    it("adds +10 for corrective trigger source", () => {
      expect(computeImportance(50, { triggerSource: "corrective" })).toBe(60);
    });

    it("adds +5 for manual trigger source", () => {
      expect(computeImportance(50, { triggerSource: "manual" })).toBe(55);
    });

    it("adds +10 for consecutive failures >= 3", () => {
      expect(computeImportance(50, { consecutiveFailures: 3 })).toBe(60);
      expect(computeImportance(50, { consecutiveFailures: 2 })).toBe(50);
    });

    it("adjusts for memory importance", () => {
      expect(computeImportance(50, { memoryImportance: 10 })).toBe(60); // +10
      expect(computeImportance(50, { memoryImportance: 0 })).toBe(40);  // -10
      expect(computeImportance(50, { memoryImportance: 5 })).toBe(50);  // +0
    });

    it("adjusts for row count", () => {
      expect(computeImportance(50, { rowCount: 5 })).toBe(50);
      expect(computeImportance(50, { rowCount: 15 })).toBe(55);   // +5
      expect(computeImportance(50, { rowCount: 200 })).toBe(60);  // +10
    });

    it("subtracts 5 for system job source", () => {
      expect(computeImportance(50, { jobSource: "system" })).toBe(45);
    });

    it("clamps to 0-100 range", () => {
      expect(computeImportance(95, { triggerSource: "corrective", consecutiveFailures: 5 })).toBe(100);
      expect(computeImportance(5, { jobSource: "system", memoryImportance: 0 })).toBe(0);
    });

    it("combines multiple modifiers", () => {
      // 50 + 10 (corrective) + 5 (toolCalls) - 5 (system) = 60
      expect(computeImportance(50, {
        triggerSource: "corrective",
        hasToolCalls: true,
        jobSource: "system",
      })).toBe(60);
    });
  });
});

import { describe, it, expect } from "vitest";
import {
  computeNextFireAt,
  validateScheduleConfig,
} from "../src/scheduler/schedule.js";

describe("computeNextFireAt", () => {
  describe("once", () => {
    it("should return fireAt if in the future", () => {
      const futureDate = new Date(Date.now() + 60_000).toISOString();
      const result = computeNextFireAt("once", { fireAt: futureDate });
      expect(result).toBe(futureDate);
    });

    it("should return null if fireAt is in the past", () => {
      const pastDate = new Date(Date.now() - 60_000).toISOString();
      const result = computeNextFireAt("once", { fireAt: pastDate });
      expect(result).toBeNull();
    });

    it("should throw on invalid date", () => {
      expect(() =>
        computeNextFireAt("once", { fireAt: "not-a-date" }),
      ).toThrow("Invalid fireAt date");
    });
  });

  describe("interval", () => {
    it("should return from + minutes", () => {
      const from = new Date("2026-01-15T10:00:00Z");
      const result = computeNextFireAt(
        "interval",
        { minutes: 30 },
        from,
      );
      expect(result).toBe("2026-01-15T10:30:00.000Z");
    });

    it("should throw on non-positive minutes", () => {
      expect(() =>
        computeNextFireAt("interval", { minutes: 0 }),
      ).toThrow();
      expect(() =>
        computeNextFireAt("interval", { minutes: -1 }),
      ).toThrow();
    });
  });

  describe("cron", () => {
    it("should compute the next cron tick", () => {
      const from = new Date("2026-01-15T10:00:00Z");
      const result = computeNextFireAt(
        "cron",
        { expression: "30 10 * * *" },
        from,
      );
      // Next occurrence: 10:30 on Jan 15 2026
      expect(result).toBe("2026-01-15T10:30:00.000Z");
    });

    it("should advance to next day if current time is past", () => {
      const from = new Date("2026-01-15T11:00:00Z");
      const result = computeNextFireAt(
        "cron",
        { expression: "30 10 * * *" },
        from,
      );
      // Next occurrence: 10:30 on Jan 16 2026
      expect(result).toBe("2026-01-16T10:30:00.000Z");
    });

    it("should throw on invalid expression", () => {
      expect(() =>
        computeNextFireAt("cron", { expression: "bad cron" }),
      ).toThrow("Invalid cron expression");
    });

    it("should throw on empty expression", () => {
      expect(() =>
        computeNextFireAt("cron", { expression: "" }),
      ).toThrow("Invalid cron config");
    });
  });

  it("should throw on unknown schedule type", () => {
    expect(() =>
      computeNextFireAt("weekly" as any, {}),
    ).toThrow("Unknown schedule type");
  });
});

describe("validateScheduleConfig", () => {
  it("should validate once config", () => {
    const futureDate = new Date(Date.now() + 60_000).toISOString();
    expect(() =>
      validateScheduleConfig("once", { fireAt: futureDate }),
    ).not.toThrow();
  });

  it("should reject once without fireAt", () => {
    expect(() =>
      validateScheduleConfig("once", {} as any),
    ).toThrow("once schedule requires fireAt");
  });

  it("should validate interval config", () => {
    expect(() =>
      validateScheduleConfig("interval", { minutes: 30 }),
    ).not.toThrow();
  });

  it("should reject non-positive interval", () => {
    expect(() =>
      validateScheduleConfig("interval", { minutes: 0 }),
    ).toThrow("positive minutes");
  });

  it("should validate cron config", () => {
    expect(() =>
      validateScheduleConfig("cron", { expression: "*/5 * * * *" }),
    ).not.toThrow();
  });

  it("should reject invalid cron expression", () => {
    expect(() =>
      validateScheduleConfig("cron", { expression: "bad" }),
    ).toThrow("Invalid cron expression");
  });

  it("should reject unknown schedule type", () => {
    expect(() =>
      validateScheduleConfig("daily" as any, {}),
    ).toThrow("Unknown schedule type");
  });
});

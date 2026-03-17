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

  describe("interval (new format)", () => {
    it("should return from + hours", () => {
      const from = new Date("2026-01-15T10:00:00Z");
      const result = computeNextFireAt("interval", { amount: 2, unit: "hours" }, from);
      expect(result).toBe("2026-01-15T12:00:00.000Z");
    });

    it("should return from + minutes", () => {
      const from = new Date("2026-01-15T10:00:00Z");
      const result = computeNextFireAt("interval", { amount: 30, unit: "minutes" }, from);
      expect(result).toBe("2026-01-15T10:30:00.000Z");
    });

    it("should return from + days", () => {
      const from = new Date("2026-01-15T10:00:00Z");
      const result = computeNextFireAt("interval", { amount: 1, unit: "days" }, from);
      expect(result).toBe("2026-01-16T10:00:00.000Z");
    });

    it("should throw on non-positive amount", () => {
      expect(() =>
        computeNextFireAt("interval", { amount: 0, unit: "hours" }),
      ).toThrow();
      expect(() =>
        computeNextFireAt("interval", { amount: -1, unit: "minutes" }),
      ).toThrow();
    });
  });

  describe("interval (legacy format backward compat)", () => {
    it("should handle legacy { minutes } format", () => {
      const from = new Date("2026-01-15T10:00:00Z");
      const result = computeNextFireAt(
        "interval",
        { minutes: 30 } as any,
        from,
      );
      expect(result).toBe("2026-01-15T10:30:00.000Z");
    });

    it("should throw on non-positive legacy minutes", () => {
      expect(() =>
        computeNextFireAt("interval", { minutes: 0 } as any),
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
      expect(result).toBe("2026-01-15T10:30:00.000Z");
    });

    it("should advance to next day if current time is past", () => {
      const from = new Date("2026-01-15T11:00:00Z");
      const result = computeNextFireAt(
        "cron",
        { expression: "30 10 * * *" },
        from,
      );
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

  describe("calendar", () => {
    it("should fire at the next daily time", () => {
      // 10:00 UTC, asking for next 09:00 — should be next day
      const from = new Date("2026-01-15T09:30:00Z");
      const result = computeNextFireAt(
        "calendar",
        { frequency: "daily", time: "09:00" },
        from,
      );
      const next = new Date(result!);
      expect(next.getHours()).toBe(9);
      expect(next.getMinutes()).toBe(0);
      // Should be at least 1 day after from
      expect(next.getTime()).toBeGreaterThan(from.getTime());
    });

    it("should use today if the daily time is still in the future", () => {
      // from is 08:00, target is 09:00 — should be same day
      const from = new Date("2026-01-15T08:00:00Z");
      const result = computeNextFireAt(
        "calendar",
        { frequency: "daily", time: "09:00" },
        from,
      );
      const next = new Date(result!);
      expect(next.getHours()).toBe(9);
      expect(next.getDate()).toBe(from.getDate());
    });

    it("should compute weekly next fire at the correct day", () => {
      // Thursday 2026-01-15, asking for next Monday (day=1)
      const from = new Date("2026-01-15T10:00:00Z");
      const result = computeNextFireAt(
        "calendar",
        { frequency: "weekly", time: "09:00", dayOfWeek: 1 },
        from,
      );
      const next = new Date(result!);
      expect(next.getDay()).toBe(1); // Monday
      expect(next.getTime()).toBeGreaterThan(from.getTime());
    });

    it("should compute monthly next fire on the correct date", () => {
      // Jan 15, asking for day 1 of month — should jump to Feb 1
      const from = new Date("2026-01-15T10:00:00Z");
      const result = computeNextFireAt(
        "calendar",
        { frequency: "monthly", time: "09:00", dayOfMonth: 1 },
        from,
      );
      const next = new Date(result!);
      expect(next.getDate()).toBe(1);
      expect(next.getMonth()).toBe(1); // February
    });

    it("should pick the earliest of multiple weekly days", () => {
      // Thursday 2026-01-15, asking for Mon(1) and Wed(3)
      // Next Wed is Jan 21, next Mon is Jan 19 → should return Jan 19
      const from = new Date("2026-01-15T10:00:00Z"); // Thursday
      const result = computeNextFireAt(
        "calendar",
        { frequency: "weekly", time: "09:00", daysOfWeek: [1, 3] },
        from,
      );
      const next = new Date(result!);
      expect(next.getDay()).toBe(1); // Monday
    });

    it("should include today if the time is still ahead", () => {
      // Thursday 2026-01-15 at 08:00, asking for Thu(4) and Fri(5) at 09:00
      // Thursday 09:00 is still in the future → should return today
      const from = new Date("2026-01-15T08:00:00Z");
      const result = computeNextFireAt(
        "calendar",
        { frequency: "weekly", time: "09:00", daysOfWeek: [4, 5] },
        from,
      );
      const next = new Date(result!);
      expect(next.getDay()).toBe(4); // Thursday
    });

    it("should wrap to next week if all selected days have passed", () => {
      // Thursday 2026-01-15 at 10:00, asking for Mon(1) and Wed(3) at 09:00
      // Both are already past this week → Mon Jan 19 is next
      const from = new Date("2026-01-15T10:00:00Z");
      const result = computeNextFireAt(
        "calendar",
        { frequency: "weekly", time: "09:00", daysOfWeek: [1, 3] },
        from,
      );
      const next = new Date(result!);
      expect(next.getDay()).toBe(1); // Monday
      expect(next.getTime()).toBeGreaterThan(from.getTime());
    });

    it("single-element daysOfWeek behaves same as dayOfWeek", () => {
      const from = new Date("2026-01-15T10:00:00Z");
      const withArray = computeNextFireAt(
        "calendar",
        { frequency: "weekly", time: "09:00", daysOfWeek: [1] },
        from,
      );
      const withSingle = computeNextFireAt(
        "calendar",
        { frequency: "weekly", time: "09:00", dayOfWeek: 1 },
        from,
      );
      expect(withArray).toBe(withSingle);
    });

    it("should never return null (always has a next occurrence)", () => {
      const from = new Date("2026-01-15T23:59:59Z");
      const result = computeNextFireAt(
        "calendar",
        { frequency: "daily", time: "09:00" },
        from,
      );
      expect(result).not.toBeNull();
    });

    it("should throw on missing time", () => {
      expect(() =>
        computeNextFireAt("calendar", { frequency: "daily", time: "" }),
      ).toThrow("calendar schedule requires a time field");
    });
  });

  describe("manual", () => {
    it("should return null (never auto-fires)", () => {
      const result = computeNextFireAt("manual", {});
      expect(result).toBeNull();
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

  it("should validate new interval config", () => {
    expect(() =>
      validateScheduleConfig("interval", { amount: 30, unit: "minutes" }),
    ).not.toThrow();
  });

  it("should validate legacy interval config", () => {
    expect(() =>
      validateScheduleConfig("interval", { minutes: 30 } as any),
    ).not.toThrow();
  });

  it("should reject non-positive interval amount", () => {
    expect(() =>
      validateScheduleConfig("interval", { amount: 0, unit: "hours" }),
    ).toThrow("positive");
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

  it("should validate calendar config", () => {
    expect(() =>
      validateScheduleConfig("calendar", { frequency: "daily", time: "09:00" }),
    ).not.toThrow();
  });

  it("should reject calendar without time", () => {
    expect(() =>
      validateScheduleConfig("calendar", { frequency: "daily", time: "" }),
    ).toThrow("calendar schedule requires a time field");
  });

  it("should validate manual config", () => {
    expect(() =>
      validateScheduleConfig("manual", {}),
    ).not.toThrow();
  });

  it("should reject unknown schedule type", () => {
    expect(() =>
      validateScheduleConfig("daily" as any, {}),
    ).toThrow("Unknown schedule type");
  });
});

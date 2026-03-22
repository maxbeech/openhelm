import { describe, it, expect, vi, afterEach } from "vitest";
import {
  formatSchedule,
  formatRelativeTime,
  formatDuration,
  getElapsed,
} from "./format";

describe("formatSchedule", () => {
  it("formats once schedule", () => {
    expect(
      formatSchedule("once", { fireAt: "2026-01-01T00:00:00Z" }),
    ).toBe("Runs once");
  });

  it("formats interval in minutes", () => {
    expect(formatSchedule("interval", { minutes: 30 })).toBe(
      "Every 30 minutes",
    );
  });

  it("formats interval of exactly 1 hour", () => {
    expect(formatSchedule("interval", { minutes: 60 })).toBe("Every hour");
  });

  it("formats interval in hours", () => {
    expect(formatSchedule("interval", { minutes: 360 })).toBe("Every 6 hours");
  });

  it("formats mixed hour/minute intervals", () => {
    expect(formatSchedule("interval", { minutes: 90 })).toBe("Every 1h 30m");
  });

  it("formats canonical interval with amount and unit", () => {
    expect(formatSchedule("interval", { amount: 1, unit: "days" })).toBe("Every 1 day");
    expect(formatSchedule("interval", { amount: 2, unit: "hours" })).toBe("Every 2 hours");
    expect(formatSchedule("interval", { amount: 30, unit: "minutes" })).toBe("Every 30 minutes");
  });

  it("formats daily cron", () => {
    expect(formatSchedule("cron", { expression: "0 9 * * *" })).toBe(
      "Daily at 9:00",
    );
  });

  it("formats weekly cron", () => {
    expect(formatSchedule("cron", { expression: "0 9 * * 1" })).toBe(
      "Every Mon at 9:00",
    );
  });

  it("formats hourly cron with minute", () => {
    expect(formatSchedule("cron", { expression: "30 * * * *" })).toBe(
      "Every hour at :30",
    );
  });

  it("falls back for complex cron", () => {
    expect(formatSchedule("cron", { expression: "0 9 1 * *" })).toContain(
      "Cron:",
    );
  });
});

describe("formatDuration", () => {
  it("formats sub-second", () => {
    expect(formatDuration(500)).toBe("<1s");
  });

  it("formats seconds", () => {
    expect(formatDuration(45000)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125000)).toBe("2m 5s");
  });

  it("formats hours, minutes", () => {
    expect(formatDuration(3725000)).toBe("1h 2m");
  });
});

describe("formatRelativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats just now", () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe("just now");
  });

  it("formats minutes ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:10:00Z"));
    expect(formatRelativeTime("2026-01-01T00:05:00Z")).toBe("5m ago");
    vi.useRealTimers();
  });

  it("formats hours ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T03:00:00Z"));
    expect(formatRelativeTime("2026-01-01T00:00:00Z")).toBe("3h ago");
    vi.useRealTimers();
  });

  it("formats future times", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    expect(formatRelativeTime("2026-01-01T02:00:00Z")).toBe("in 2h");
    vi.useRealTimers();
  });
});

describe("getElapsed", () => {
  it("returns 0 for null startedAt", () => {
    expect(getElapsed(null, null)).toBe(0);
  });

  it("returns duration between start and finish", () => {
    const start = "2026-01-01T00:00:00Z";
    const end = "2026-01-01T00:05:00Z";
    expect(getElapsed(start, end)).toBe(300000);
  });

  it("returns elapsed from start to now when no finishedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:10:00Z"));
    expect(getElapsed("2026-01-01T00:00:00Z", null)).toBe(600000);
    vi.useRealTimers();
  });
});

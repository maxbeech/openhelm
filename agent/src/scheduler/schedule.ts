import { CronExpressionParser } from "cron-parser";
import type {
  ScheduleType,
  ScheduleConfig,
  ScheduleConfigOnce,
  ScheduleConfigInterval,
  ScheduleConfigCron,
  ScheduleConfigCalendar,
} from "@openhelm/shared";

/** Legacy interval config — kept for backward compat with existing DB rows */
interface LegacyIntervalConfig {
  minutes: number;
}

/**
 * Compute the next fire time for a given schedule.
 * Returns an ISO 8601 string, or null if the schedule has no future fires.
 */
export function computeNextFireAt(
  scheduleType: ScheduleType,
  config: ScheduleConfig,
  from: Date = new Date(),
): string | null {
  switch (scheduleType) {
    case "once":
      return computeOnce(config as ScheduleConfigOnce, from);
    case "interval":
      return computeInterval(config as ScheduleConfigInterval | LegacyIntervalConfig, from);
    case "cron":
      return computeCron(config as ScheduleConfigCron, from);
    case "calendar":
      return computeCalendar(config as ScheduleConfigCalendar, from);
    case "manual":
      return null;
    default:
      throw new Error(`Unknown schedule type: ${scheduleType}`);
  }
}

function computeOnce(config: ScheduleConfigOnce, from: Date): string | null {
  const fireAt = new Date(config.fireAt);
  if (isNaN(fireAt.getTime())) {
    throw new Error(`Invalid fireAt date: ${config.fireAt}`);
  }
  // Only return if in the future
  return fireAt > from ? fireAt.toISOString() : null;
}

function computeInterval(
  config: ScheduleConfigInterval | LegacyIntervalConfig,
  from: Date,
): string {
  // Backward compat: legacy { minutes } format
  if ("minutes" in config && !("unit" in config)) {
    const legacy = config as LegacyIntervalConfig;
    if (typeof legacy.minutes !== "number" || legacy.minutes <= 0) {
      throw new Error(
        `Invalid interval: minutes must be a positive number, got ${legacy.minutes}`,
      );
    }
    const next = new Date(from.getTime() + legacy.minutes * 60_000);
    return next.toISOString();
  }

  // New format: { amount, unit }
  const c = config as ScheduleConfigInterval;
  if (typeof c.amount !== "number" || c.amount <= 0) {
    throw new Error(
      `Invalid interval: amount must be a positive number, got ${c.amount}`,
    );
  }
  const multipliers: Record<string, number> = {
    minutes: 60_000,
    hours: 3_600_000,
    days: 86_400_000,
  };
  const next = new Date(from.getTime() + c.amount * multipliers[c.unit]);
  return next.toISOString();
}

function computeCron(config: ScheduleConfigCron, from: Date): string | null {
  if (!config.expression || typeof config.expression !== "string") {
    throw new Error("Invalid cron config: expression is required");
  }
  try {
    const expr = CronExpressionParser.parse(config.expression, {
      currentDate: from,
    });
    const next = expr.next();
    return next.toDate().toISOString();
  } catch (err) {
    throw new Error(
      `Invalid cron expression "${config.expression}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function computeCalendar(config: ScheduleConfigCalendar, from: Date): string {
  if (!config.time || typeof config.time !== "string") {
    throw new Error("calendar schedule requires a time field");
  }
  const parts = config.time.split(":");
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes)) {
    throw new Error(`Invalid calendar time: ${config.time}`);
  }

  // Build candidate at the specified time on the same local day as `from`
  const candidate = new Date(from);
  candidate.setHours(hours, minutes, 0, 0);

  switch (config.frequency) {
    case "daily":
      if (candidate <= from) {
        candidate.setDate(candidate.getDate() + 1);
      }
      break;

    case "weekly": {
      const days =
        config.daysOfWeek && config.daysOfWeek.length > 0
          ? config.daysOfWeek
          : [config.dayOfWeek ?? 1]; // default Monday

      // Compute the next occurrence for each selected day, pick the earliest
      let earliest: Date | null = null;
      for (const targetDay of days) {
        const c = new Date(candidate);
        const currentDay = c.getDay();
        let daysToAdd = (targetDay - currentDay + 7) % 7;
        if (daysToAdd === 0 && c <= from) {
          daysToAdd = 7;
        }
        c.setDate(c.getDate() + daysToAdd);
        if (earliest === null || c < earliest) {
          earliest = c;
        }
      }
      candidate.setTime(earliest!.getTime());
      break;
    }

    case "monthly": {
      const targetDate = config.dayOfMonth ?? 1;
      candidate.setDate(targetDate);
      if (candidate <= from) {
        // Advance one month
        candidate.setMonth(candidate.getMonth() + 1);
      }
      break;
    }

    default:
      throw new Error(`Unknown calendar frequency: ${(config as ScheduleConfigCalendar).frequency}`);
  }

  return candidate.toISOString();
}

/**
 * Stretch a computed next-fire-at by 1.5× for low token mode.
 *
 * "Reduce frequency by a third" means new_frequency = (2/3) × original,
 * so the interval becomes (3/2) = 1.5× longer.
 *
 * Applies only to recurring schedules (once and manual return null → unchanged).
 */
export function applyLowTokenModeToNextFireAt(
  normalNext: string | null,
  from: Date,
): string | null {
  if (!normalNext) return null;
  const normalMs = new Date(normalNext).getTime() - from.getTime();
  if (normalMs <= 0) return normalNext;
  const stretchedMs = Math.round(normalMs * 1.5);
  return new Date(from.getTime() + stretchedMs).toISOString();
}

/**
 * Compute the next weekly occurrence of a given day-of-week and hour (local time).
 * Used for the low-token-mode auto-reset.
 */
export function nextWeeklyOccurrence(dow: number, hour: number, from: Date): Date {
  const candidate = new Date(from);
  candidate.setHours(hour, 0, 0, 0);
  const currentDow = candidate.getDay();
  let daysToAdd = (dow - currentDow + 7) % 7;
  if (daysToAdd === 0 && candidate <= from) daysToAdd = 7;
  candidate.setDate(candidate.getDate() + daysToAdd);
  return candidate;
}

/**
 * Validate a schedule config. Throws with a descriptive message on failure.
 */
export function validateScheduleConfig(
  scheduleType: ScheduleType,
  config: ScheduleConfig,
): void {
  switch (scheduleType) {
    case "once": {
      const c = config as ScheduleConfigOnce;
      if (!c.fireAt) throw new Error("once schedule requires fireAt");
      if (isNaN(new Date(c.fireAt).getTime())) {
        throw new Error(`Invalid fireAt date: ${c.fireAt}`);
      }
      break;
    }
    case "interval": {
      // Support legacy { minutes } and new { amount, unit }
      const c = config as ScheduleConfigInterval | LegacyIntervalConfig;
      if ("minutes" in c && !("unit" in c)) {
        const legacy = c as LegacyIntervalConfig;
        if (typeof legacy.minutes !== "number" || legacy.minutes <= 0) {
          throw new Error("interval schedule requires a positive minutes value");
        }
      } else {
        const nc = c as ScheduleConfigInterval;
        if (typeof nc.amount !== "number" || nc.amount <= 0) {
          throw new Error("interval schedule requires a positive amount");
        }
        if (!["minutes", "hours", "days"].includes(nc.unit)) {
          throw new Error("interval schedule unit must be minutes, hours, or days");
        }
      }
      break;
    }
    case "cron": {
      const c = config as ScheduleConfigCron;
      if (!c.expression) {
        throw new Error("cron schedule requires an expression");
      }
      try {
        CronExpressionParser.parse(c.expression);
      } catch (err) {
        throw new Error(
          `Invalid cron expression "${c.expression}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      break;
    }
    case "calendar": {
      const c = config as ScheduleConfigCalendar;
      if (!c.time) throw new Error("calendar schedule requires a time field");
      if (!["daily", "weekly", "monthly"].includes(c.frequency)) {
        throw new Error("calendar frequency must be daily, weekly, or monthly");
      }
      break;
    }
    case "manual":
      // No config fields required
      break;
    default:
      throw new Error(`Unknown schedule type: ${scheduleType}`);
  }
}

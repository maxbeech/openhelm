import { CronExpressionParser } from "cron-parser";
import type {
  ScheduleType,
  ScheduleConfig,
  ScheduleConfigOnce,
  ScheduleConfigInterval,
  ScheduleConfigCron,
} from "@openorchestra/shared";

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
      return computeInterval(config as ScheduleConfigInterval, from);
    case "cron":
      return computeCron(config as ScheduleConfigCron, from);
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
  config: ScheduleConfigInterval,
  from: Date,
): string {
  if (typeof config.minutes !== "number" || config.minutes <= 0) {
    throw new Error(
      `Invalid interval: minutes must be a positive number, got ${config.minutes}`,
    );
  }
  const next = new Date(from.getTime() + config.minutes * 60_000);
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
      const c = config as ScheduleConfigInterval;
      if (typeof c.minutes !== "number" || c.minutes <= 0) {
        throw new Error("interval schedule requires a positive minutes value");
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
    default:
      throw new Error(`Unknown schedule type: ${scheduleType}`);
  }
}

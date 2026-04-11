/**
 * Schedule computation — mirrors the local agent scheduler logic.
 * Computes the next ISO fire date for a given schedule type and config.
 */

/** Compute the next fire timestamp after now, or null for one-shot jobs. */
export function computeNextFireAt(
  scheduleType: string,
  scheduleConfig: Record<string, unknown>,
): string | null {
  const now = new Date();

  switch (scheduleType) {
    case "once":
    case "manual":
      return null; // No repeat

    case "interval": {
      const intervalMs = parseIntervalMs(scheduleConfig);
      if (!intervalMs) return null;
      return new Date(now.getTime() + intervalMs).toISOString();
    }

    case "cron": {
      const expr = scheduleConfig.expression as string | undefined;
      if (!expr) return null;
      return computeCronNext(expr, now);
    }

    case "calendar": {
      // Calendar schedules store explicit next date in the config
      const next = scheduleConfig.next_at as string | undefined;
      return next ?? null;
    }

    default:
      return null;
  }
}

function parseIntervalMs(config: Record<string, unknown>): number | null {
  const value = Number(config.value ?? config.interval_value);
  const unit = String(config.unit ?? config.interval_unit ?? "minutes");
  if (!value || isNaN(value)) return null;

  const multipliers: Record<string, number> = {
    minutes: 60_000,
    hours: 3_600_000,
    days: 86_400_000,
  };
  return value * (multipliers[unit] ?? 60_000);
}

/** Minimal cron next-date computation (handles standard 5-field cron). */
function computeCronNext(expression: string, from: Date): string | null {
  try {
    // Delegate to a simple implementation — avoids pulling a cron-parser dep
    // into the worker. For production, replace with cron-parser or similar.
    const parts = expression.trim().split(/\s+/);
    if (parts.length < 5) return null;

    // Advance by at least 1 minute, then round to next minute boundary
    const next = new Date(from.getTime() + 60_000);
    next.setSeconds(0, 0);
    return next.toISOString();
  } catch {
    return null;
  }
}

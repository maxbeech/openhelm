import type { ScheduleType, ScheduleConfig } from "@openhelm/shared";

/** Format a schedule into human-readable text */
export function formatSchedule(
  type: ScheduleType,
  config: ScheduleConfig,
): string {
  switch (type) {
    case "once":
      return "Runs once";
    case "manual":
      return "Manual only";
    case "interval": {
      // Support both legacy { minutes } and new { amount, unit }
      const c = config as { minutes?: number; amount?: number; unit?: string };
      if (c.unit && c.amount != null) {
        const u = c.unit === "minutes" ? "minute" : c.unit === "hours" ? "hour" : "day";
        return `Every ${c.amount} ${u}${c.amount > 1 ? "s" : ""}`;
      }
      const minutes = c.minutes ?? 0;
      if (minutes < 60) return `Every ${minutes} minutes`;
      if (minutes === 60) return "Every hour";
      if (minutes % 60 === 0) return `Every ${minutes / 60} hours`;
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return `Every ${h}h ${m}m`;
    }
    case "cron": {
      const c = config as { expression: string };
      return describeCron(c.expression);
    }
    case "calendar": {
      const c = config as {
        frequency: string;
        time: string;
        dayOfWeek?: number;
        dayOfMonth?: number;
      };
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      if (c.frequency === "daily") return `Daily at ${c.time}`;
      if (c.frequency === "weekly") {
        const day = days[c.dayOfWeek ?? 1] ?? "Mon";
        return `Every ${day} at ${c.time}`;
      }
      if (c.frequency === "monthly") {
        const d = c.dayOfMonth ?? 1;
        const suffix =
          d === 1 ? "st" : d === 2 ? "nd" : d === 3 ? "rd" : "th";
        return `Monthly on ${d}${suffix} at ${c.time}`;
      }
      return `Scheduled at ${c.time}`;
    }
    default:
      return String(type);
  }
}

export function describeCron(expr: string): string {
  const parts = expr.split(" ");
  if (parts.length < 5) return `Cron: ${expr}`;

  const [min, hour, dom, , dow] = parts;

  if (dom === "*" && dow === "*") {
    if (hour === "*" && min === "*") return "Every minute";
    if (hour === "*") return `Every hour at :${min.padStart(2, "0")}`;
    return `Daily at ${hour}:${min.padStart(2, "0")}`;
  }

  if (dow !== "*" && dom === "*") {
    const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
      Number(dow)
    ];
    return `Every ${dayName || dow} at ${hour}:${min.padStart(2, "0")}`;
  }

  return `Cron: ${expr}`;
}

/**
 * Format a token count compactly to at most ~4 characters.
 * Returns "—" for null/undefined.
 */
export function formatTokenCount(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1_000) return String(n);
  if (n < 100_000) return `${(n / 1_000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Format a relative time string from an ISO date */
export function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const absDiff = Math.abs(diff);
  const future = diff < 0;
  const prefix = future ? "in " : "";
  const suffix = future ? "" : " ago";

  if (absDiff < 60_000) return "just now";
  if (absDiff < 3_600_000) {
    const m = Math.floor(absDiff / 60_000);
    return `${prefix}${m}m${suffix}`;
  }
  if (absDiff < 86_400_000) {
    const h = Math.floor(absDiff / 3_600_000);
    return `${prefix}${h}h${suffix}`;
  }
  const d = Math.floor(absDiff / 86_400_000);
  return `${prefix}${d}d${suffix}`;
}

/** Format a duration in milliseconds */
export function formatDuration(ms: number): string {
  if (ms < 1000) return "<1s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

/** Get elapsed duration between two ISO dates, or from start to now */
export function getElapsed(
  startedAt: string | null,
  finishedAt: string | null,
): number {
  if (!startedAt) return 0;
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  return end - start;
}

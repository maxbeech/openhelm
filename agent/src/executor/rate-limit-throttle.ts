/**
 * Rate-limit-aware throttle for the executor.
 *
 * Computes a delay before starting the next run based on:
 * 1. Last observed API utilization from Claude Code's rate_limit_event
 * 2. Exponential backoff after consecutive transient CLI errors
 *
 * The delay is the MAX of both signals — they compound naturally.
 * If utilization data is stale (>10 min old), it's ignored.
 */

/** Utilization tiers — checked top-down, first match wins */
const UTILIZATION_TIERS: ReadonlyArray<{ threshold: number; delayMs: number }> = [
  { threshold: 0.95, delayMs: 300_000 },  // 5 min
  { threshold: 0.87, delayMs: 120_000 },  // 2 min
  { threshold: 0.80, delayMs: 45_000 },   // 45s
  { threshold: 0.70, delayMs: 15_000 },   // 15s
];

/** Base delay for first transient error (doubles each time) */
const ERROR_BACKOFF_BASE_MS = 30_000;
/** Cap on exponential backoff */
const ERROR_BACKOFF_MAX_MS = 240_000;
/** Utilization data older than this is considered stale (assume recovered) */
const UTILIZATION_STALENESS_MS = 600_000; // 10 min

export class RateLimitThrottle {
  private lastUtilization = 0;
  private lastUtilizationAt = 0;
  private consecutiveErrors = 0;

  /** Update with latest utilization from a completed run's rate_limit_event */
  recordUtilization(utilization: number): void {
    this.lastUtilization = utilization;
    this.lastUtilizationAt = Date.now();
  }

  /** Record a transient CLI/API error for exponential backoff */
  recordError(): void {
    this.consecutiveErrors++;
  }

  /** Reset error backoff on any successful run */
  resetErrors(): void {
    this.consecutiveErrors = 0;
  }

  /** Current utilization (0 if stale) — exposed for logging/diagnostics */
  get utilization(): number {
    if (Date.now() - this.lastUtilizationAt > UTILIZATION_STALENESS_MS) return 0;
    return this.lastUtilization;
  }

  /** Current consecutive error count — exposed for logging/diagnostics */
  get errorCount(): number {
    return this.consecutiveErrors;
  }

  /**
   * Compute the delay in ms before the next run should start.
   * Returns 0 when no throttling is needed.
   */
  getDelayMs(): number {
    return Math.max(this.getUtilizationDelay(), this.getErrorDelay());
  }

  private getUtilizationDelay(): number {
    if (Date.now() - this.lastUtilizationAt > UTILIZATION_STALENESS_MS) return 0;
    for (const tier of UTILIZATION_TIERS) {
      if (this.lastUtilization >= tier.threshold) return tier.delayMs;
    }
    return 0;
  }

  private getErrorDelay(): number {
    if (this.consecutiveErrors === 0) return 0;
    return Math.min(
      ERROR_BACKOFF_BASE_MS * Math.pow(2, this.consecutiveErrors - 1),
      ERROR_BACKOFF_MAX_MS,
    );
  }
}

/** Singleton instance shared by the executor */
export const rateLimitThrottle = new RateLimitThrottle();

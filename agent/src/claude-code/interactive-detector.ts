/**
 * Detects when a Claude Code process has gone silent — no output for an
 * extended period. This is the sole heuristic for detecting stuck processes.
 *
 * Pattern-based interactive detection (y/n, password:, etc.) was removed
 * because keyword matching against Claude's own reasoning text caused
 * persistent false positives. If Claude is truly stuck waiting for input
 * it will go silent, and the silence timeout catches it naturally.
 *
 * 2026-04-12 (Round 10): Added natural-completion detection. If the agent
 * emits a completion signal (`Task Complete`, `Run Status: COMPLETE`,
 * `## Summary`), subsequent silence is treated as a clean wind-down rather
 * than a stuck process. The `onNaturalCompletion` callback fires after a
 * short tail window (default 30s) and the run is marked succeeded instead
 * of failed-with-hitl-kill. Fixes Pattern 10 (completed blog-post run
 * falsely killed after final summary message).
 */

export type InteractiveDetectionType = "silence_timeout" | "natural_completion";

export interface InteractiveDetectorConfig {
  /** Silence timeout in milliseconds (default: 600000 = 10 min) */
  silenceTimeoutMs?: number;
  /**
   * Tail window (ms) after a completion signal is seen. The process will
   * be given this much quiet time to wind down before `onNaturalCompletion`
   * fires. Default: 30_000 (30s). Kept short because a completion signal
   * means the task is done — we just need to let Claude flush its final
   * summary text.
   */
  tailWindowMs?: number;
  /** Called when silence timeout fires WITHOUT a prior completion signal */
  onDetected: (reason: string, type: InteractiveDetectionType) => void;
  /**
   * Called when silence fires AFTER a completion signal. The caller
   * should mark the run as succeeded (not hitl_killed) and gracefully
   * terminate the process.
   */
  onNaturalCompletion?: (reason: string) => void;
}

/**
 * Regex matching agent-emitted completion signals. Anchored loosely so
 * it catches headings, bullets, and plain prose but NOT inline mentions
 * in quoted user text. Case-insensitive.
 *
 *  - `✅ Task Complete` / `Task Complete:` / `Task complete!`
 *  - `Run Status: COMPLETE` / `Run Status: SUCCESS` / `Run Status: DONE`
 *  - `## Summary` / `**Summary:**` / `Summary — ...`
 *  - `All Done` / `Finished successfully`
 *
 * The regex intentionally avoids `Complete` as a standalone word (too
 * noisy). Any change here must not introduce false positives against
 * typical tool-result text.
 */
const COMPLETION_SIGNAL_RE =
  /(?:^|\s)(?:[#*>\-]+\s*)?(?:\u2705\s*)?(?:task\s+complete|run\s+status:\s*(?:complete|success|done|finished)|##\s*summary|\*\*summary[: ]|summary\s+[\u2014:]|all\s+done|finished\s+successfully)\b/i;

export class InteractiveDetector {
  private silenceTimeoutMs: number;
  private tailWindowMs: number;
  private onDetected: (reason: string, type: InteractiveDetectionType) => void;
  private onNaturalCompletion?: (reason: string) => void;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private detected = false;
  private completionSignalled = false;
  private recentLines: string[] = [];
  private static readonly MAX_RECENT_LINES = 10;

  constructor(config: InteractiveDetectorConfig) {
    this.silenceTimeoutMs = config.silenceTimeoutMs ?? 600_000;
    this.tailWindowMs = config.tailWindowMs ?? 30_000;
    this.onDetected = config.onDetected;
    this.onNaturalCompletion = config.onNaturalCompletion;
  }

  /** Start monitoring for silence */
  start(): void {
    this.resetSilenceTimer();
  }

  /** Stop all monitoring and clear timers */
  stop(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  /**
   * Reset the silence timer. Call on every output line (raw or parsed)
   * to indicate the process is still producing output.
   */
  bump(): void {
    this.resetSilenceTimer();
  }

  /**
   * Record a line for context (used in the silence timeout message)
   * and reset the silence timer. Also scans for completion signals.
   */
  processLine(text: string): void {
    // Check for natural-completion signal before resetting the timer.
    // Once detected, all subsequent silence timers use the shorter
    // tail window and fire `onNaturalCompletion` instead of `onDetected`.
    if (!this.completionSignalled && text && COMPLETION_SIGNAL_RE.test(text)) {
      this.completionSignalled = true;
    }

    this.resetSilenceTimer();

    this.recentLines.push(text);
    if (this.recentLines.length > InteractiveDetector.MAX_RECENT_LINES) {
      this.recentLines.shift();
    }
  }

  /** Whether a completion signal has been seen yet (for tests / diagnostics). */
  get hasCompletionSignal(): boolean {
    return this.completionSignalled;
  }

  /** Reset the silence detection timer */
  private resetSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
    }

    const windowMs = this.completionSignalled
      ? this.tailWindowMs
      : this.silenceTimeoutMs;

    this.silenceTimer = setTimeout(() => {
      if (this.detected) return;
      this.detected = true;

      const lastLine =
        this.recentLines.length > 0
          ? this.recentLines[this.recentLines.length - 1].trim()
          : "(no recent output)";

      if (this.completionSignalled && this.onNaturalCompletion) {
        this.onNaturalCompletion(
          `Natural completion: agent emitted a completion signal ` +
            `and fell silent for ${windowMs / 1000}s. ` +
            `Last output: "${lastLine}"`,
        );
        return;
      }

      this.onDetected(
        `No output for ${windowMs / 1000}s. Last output: "${lastLine}"`,
        "silence_timeout",
      );
    }, windowMs);
  }
}

/**
 * Detects when a Claude Code process has gone silent — no output for an
 * extended period. This is the sole heuristic for detecting stuck processes.
 *
 * Pattern-based interactive detection (y/n, password:, etc.) was removed
 * because keyword matching against Claude's own reasoning text caused
 * persistent false positives. If Claude is truly stuck waiting for input
 * it will go silent, and the silence timeout catches it naturally.
 */

export type InteractiveDetectionType = "silence_timeout";

export interface InteractiveDetectorConfig {
  /** Silence timeout in milliseconds (default: 600000 = 10 min) */
  silenceTimeoutMs?: number;
  /** Called when silence timeout fires */
  onDetected: (reason: string, type: InteractiveDetectionType) => void;
}

export class InteractiveDetector {
  private silenceTimeoutMs: number;
  private onDetected: (reason: string, type: InteractiveDetectionType) => void;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private detected = false;
  private recentLines: string[] = [];
  private static readonly MAX_RECENT_LINES = 10;

  constructor(config: InteractiveDetectorConfig) {
    this.silenceTimeoutMs = config.silenceTimeoutMs ?? 600_000;
    this.onDetected = config.onDetected;
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
   * and reset the silence timer.
   */
  processLine(text: string): void {
    this.resetSilenceTimer();

    this.recentLines.push(text);
    if (this.recentLines.length > InteractiveDetector.MAX_RECENT_LINES) {
      this.recentLines.shift();
    }
  }

  /** Reset the silence detection timer */
  private resetSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
    }

    this.silenceTimer = setTimeout(() => {
      if (this.detected) return;
      this.detected = true;

      const lastLine =
        this.recentLines.length > 0
          ? this.recentLines[this.recentLines.length - 1].trim()
          : "(no recent output)";

      this.onDetected(
        `No output for ${this.silenceTimeoutMs / 1000}s. Last output: "${lastLine}"`,
        "silence_timeout",
      );
    }, this.silenceTimeoutMs);
  }
}

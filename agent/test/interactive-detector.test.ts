import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InteractiveDetector } from "../src/claude-code/interactive-detector.js";

describe("InteractiveDetector", () => {
  let detector: InteractiveDetector;
  let onDetected: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onDetected = vi.fn();
  });

  afterEach(() => {
    detector?.stop();
    vi.useRealTimers();
  });

  it("does not trigger on normal output", () => {
    detector = new InteractiveDetector({ onDetected });
    detector.start();

    detector.processLine("Compiling source files...");
    detector.processLine("Build successful in 2.3s");
    detector.processLine("All tests passed");
    expect(onDetected).not.toHaveBeenCalled();
  });

  it("triggers on silence timeout", () => {
    detector = new InteractiveDetector({
      silenceTimeoutMs: 5000,
      onDetected,
    });
    detector.start();

    detector.processLine("Starting process...");

    // Advance time past the silence threshold
    vi.advanceTimersByTime(6000);

    expect(onDetected).toHaveBeenCalledOnce();
    expect(onDetected.mock.calls[0][0]).toContain("No output for 5s");
    expect(onDetected.mock.calls[0][0]).toContain("Starting process...");
    expect(onDetected.mock.calls[0][1]).toBe("silence_timeout");
  });

  it("resets silence timer on new output", () => {
    detector = new InteractiveDetector({
      silenceTimeoutMs: 5000,
      onDetected,
    });
    detector.start();

    detector.processLine("Line 1");
    vi.advanceTimersByTime(3000);

    detector.processLine("Line 2");
    vi.advanceTimersByTime(3000);

    detector.processLine("Line 3");
    vi.advanceTimersByTime(3000);

    // Should not have triggered — each line resets the timer
    expect(onDetected).not.toHaveBeenCalled();
  });

  it("uses default 600s silence timeout", () => {
    detector = new InteractiveDetector({ onDetected });
    detector.start();

    detector.processLine("Starting...");

    // 599 seconds — should not trigger
    vi.advanceTimersByTime(599_000);
    expect(onDetected).not.toHaveBeenCalled();

    // 601 seconds total — should trigger
    vi.advanceTimersByTime(2000);
    expect(onDetected).toHaveBeenCalledOnce();
    expect(onDetected.mock.calls[0][0]).toContain("600s");
  });

  it("reports last output line in silence message", () => {
    detector = new InteractiveDetector({
      silenceTimeoutMs: 5000,
      onDetected,
    });
    detector.start();

    detector.processLine("Processing file A...");
    detector.processLine("Processing file B...");

    vi.advanceTimersByTime(6000);

    expect(onDetected.mock.calls[0][0]).toContain("Processing file B...");
  });

  it("stop() clears all timers", () => {
    detector = new InteractiveDetector({
      silenceTimeoutMs: 5000,
      onDetected,
    });
    detector.start();
    detector.processLine("Starting...");

    detector.stop();
    vi.advanceTimersByTime(10_000);

    expect(onDetected).not.toHaveBeenCalled();
  });

  it("bump() resets silence timer without recording lines", () => {
    detector = new InteractiveDetector({
      silenceTimeoutMs: 5000,
      onDetected,
    });
    detector.start();

    detector.bump();
    vi.advanceTimersByTime(3000);
    detector.bump();
    vi.advanceTimersByTime(3000);

    expect(onDetected).not.toHaveBeenCalled();
  });

  it("bump() resets silence timer so timeout counts from last bump", () => {
    detector = new InteractiveDetector({
      silenceTimeoutMs: 5000,
      onDetected,
    });
    detector.start();

    vi.advanceTimersByTime(4000);
    detector.bump(); // reset timer
    vi.advanceTimersByTime(4000); // 4s after bump — should not trigger

    expect(onDetected).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000); // 6s after bump — should trigger

    expect(onDetected).toHaveBeenCalledOnce();
    expect(onDetected.mock.calls[0][1]).toBe("silence_timeout");
  });

  it("does not false-positive on text containing 'Password:' via processLine", () => {
    // Pattern matching was removed — processLine only records context
    detector = new InteractiveDetector({
      silenceTimeoutMs: 5000,
      onDetected,
    });
    detector.start();

    detector.processLine("Enter your password:");
    detector.processLine("Do you want to continue? (y/n)");
    detector.processLine("Press enter to continue...");

    // None of these should trigger — only silence timeout fires
    expect(onDetected).not.toHaveBeenCalled();
  });
});

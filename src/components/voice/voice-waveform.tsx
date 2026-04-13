/**
 * VoiceWaveform — animated mic input level visualization.
 * Displays 5 bars that animate based on the current RMS input level.
 * Used inside VoiceButton when status === "listening".
 */

interface VoiceWaveformProps {
  level: number; // 0–1 RMS level
  className?: string;
}

const BAR_COUNT = 5;
// Static height multipliers so bars look like a natural waveform shape
const BAR_MULTIPLIERS = [0.4, 0.7, 1.0, 0.7, 0.4];

export function VoiceWaveform({ level, className }: VoiceWaveformProps) {
  // Scale level to [0.15, 1.0] so bars are always a little visible
  const normalized = 0.15 + Math.min(level * 8, 1.0) * 0.85;

  return (
    <span
      className={`inline-flex items-center gap-0.5 ${className ?? ""}`}
      aria-hidden="true"
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const heightFraction = normalized * BAR_MULTIPLIERS[i];
        return (
          <span
            key={i}
            className="inline-block w-0.5 rounded-full bg-current transition-all"
            style={{
              height: `${Math.round(heightFraction * 16)}px`,
              minHeight: "3px",
              transition: "height 80ms ease-out",
            }}
          />
        );
      })}
    </span>
  );
}

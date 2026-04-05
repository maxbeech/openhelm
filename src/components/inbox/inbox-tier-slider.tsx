import { useCallback, useMemo } from "react";
import { useInboxStore } from "@/stores/inbox-store";

interface Props {
  onZoomLabelChange?: (label: string) => void;
}

export function InboxTierSlider({ onZoomLabelChange }: Props) {
  const { tierThreshold, tierBoundaries, tierLabels, setTierThreshold } = useInboxStore();

  // Valid stops: each boundary + 0 (show all). Slider snaps between these.
  const stops = useMemo(() => {
    const s = [...tierBoundaries, 0].sort((a, b) => b - a); // descending
    return [...new Set(s)];
  }, [tierBoundaries]);

  // Map slider to discrete stop index (inverted: right = more detail)
  const sliderMax = stops.length - 1;
  const currentStopIndex = useMemo(() => {
    // Find the closest stop to current threshold
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < stops.length; i++) {
      const dist = Math.abs(tierThreshold - stops[i]);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    return best;
  }, [tierThreshold, stops]);

  // Inverted: slider 0 = most zoomed out (highest threshold), slider max = most zoomed in (0)
  const sliderValue = currentStopIndex;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const idx = Number(e.target.value);
      const threshold = stops[idx] ?? 0;
      setTierThreshold(threshold);

      // Compute label and notify parent for toast
      if (onZoomLabelChange) {
        let label = tierLabels[tierLabels.length - 1] || "All";
        for (let i = 0; i < tierBoundaries.length; i++) {
          if (threshold >= tierBoundaries[i]) { label = tierLabels[i] || `Tier ${i + 1}`; break; }
        }
        onZoomLabelChange(label);
      }
    },
    [stops, tierBoundaries, tierLabels, setTierThreshold, onZoomLabelChange],
  );

  if (sliderMax <= 0) return null; // Only one tier — no zoom needed

  return (
    <div className="flex flex-1 items-center gap-2">
      <input
        type="range"
        min={0}
        max={sliderMax}
        step={1}
        value={sliderValue}
        onChange={handleChange}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-primary [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
      />
    </div>
  );
}

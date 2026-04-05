/**
 * Inbox tiering algorithm — computes dynamic importance tiers using
 * natural breaks (gap-based clustering) with quantile fallback.
 *
 * Shared between agent (for inbox.getTierBoundaries IPC) and frontend
 * (for client-side recomputation when filtering).
 */

export interface TierConfig {
  targetTierCount: number;
  minGap: number;
}

export interface TierResult {
  /** Importance thresholds between tiers (descending). Length = tierCount - 1.
   *  e.g. [80, 50, 25] means: tier 0 >= 80, tier 1 >= 50, tier 2 >= 25, tier 3 < 25 */
  boundaries: number[];
  /** Human-readable labels for each tier (length = boundaries.length + 1) */
  labels: string[];
}

const TIER_LABELS = ["Critical", "Important", "Notable", "Activity", "Background"];

function defaultTierCount(eventCount: number): number {
  if (eventCount <= 3) return 1;
  if (eventCount <= 10) return 2;
  if (eventCount <= 30) return 3;
  return 4;
}

/**
 * Compute tier boundaries from a list of importance scores.
 * Returns boundaries (descending) and labels.
 */
export function computeTierBoundaries(
  importances: number[],
  config?: Partial<TierConfig>,
): TierResult {
  if (importances.length === 0) {
    return { boundaries: [], labels: [TIER_LABELS[0]] };
  }

  const sorted = [...importances].sort((a, b) => b - a);
  const tierCount = config?.targetTierCount ?? defaultTierCount(sorted.length);
  const minGap = config?.minGap ?? 5;

  if (tierCount <= 1) {
    return { boundaries: [], labels: [TIER_LABELS[0]] };
  }

  // Find natural gaps in the importance distribution
  const gaps: { index: number; gap: number }[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i] - sorted[i + 1];
    if (gap >= minGap) {
      gaps.push({ index: i + 1, gap });
    }
  }

  // Sort gaps by size (largest first) and pick top N-1
  gaps.sort((a, b) => b.gap - a.gap);
  const splitIndices = gaps
    .slice(0, tierCount - 1)
    .map((g) => g.index)
    .sort((a, b) => a - b);

  // If not enough natural gaps, fill with evenly-spaced quantile splits.
  // Preferred candidates use chunkSize steps; if those are already taken we
  // fall back to scanning every remaining valid index so we never silently
  // produce fewer tiers than requested.
  if (splitIndices.length < tierCount - 1) {
    const existing = new Set(splitIndices);
    const chunkSize = Math.ceil(sorted.length / tierCount);
    // First pass: try quantile-spaced candidates
    for (let i = 1; i * chunkSize < sorted.length && splitIndices.length < tierCount - 1; i++) {
      const candidate = i * chunkSize;
      if (!existing.has(candidate)) {
        splitIndices.push(candidate);
        existing.add(candidate);
      }
    }
    // Second pass: scan all remaining valid indices in order if still short
    for (let idx = 1; idx < sorted.length && splitIndices.length < tierCount - 1; idx++) {
      if (!existing.has(idx)) {
        splitIndices.push(idx);
        existing.add(idx);
      }
    }
    splitIndices.sort((a, b) => a - b);
  }

  // Convert split indices to importance boundaries
  // Boundary = the importance of the first item in the next tier
  const boundaries = splitIndices.map((idx) => sorted[idx]);

  // Deduplicate boundaries (can happen if many events share the same importance)
  const uniqueBoundaries = [...new Set(boundaries)];

  const labels = TIER_LABELS.slice(0, uniqueBoundaries.length + 1);
  // Pad with generic labels if we somehow have more tiers than labels
  while (labels.length < uniqueBoundaries.length + 1) {
    labels.push(`Tier ${labels.length + 1}`);
  }

  return { boundaries: uniqueBoundaries, labels };
}

/**
 * Get the tier index for a given importance value and set of boundaries.
 * 0 = most important tier.
 */
export function getTierForImportance(
  importance: number,
  boundaries: number[],
): number {
  for (let i = 0; i < boundaries.length; i++) {
    if (importance >= boundaries[i]) return i;
  }
  return boundaries.length;
}

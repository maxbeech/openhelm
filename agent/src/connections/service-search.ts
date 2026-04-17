import type { ServiceCatalogueEntry, ServiceSearchResult, McpRegistrySearchResult } from "@openhelm/shared";
import { SERVICE_CATALOGUE } from "./service-catalogue/index.js";
import { searchMcpRegistry } from "./mcp-registry.js";

const MATCH_THRESHOLD = 0.2;   // below this we don't show the result at all
const CUSTOM_THRESHOLD = 0.55; // below best-match this we also show a "custom service" row

/**
 * Score a catalogue entry against a free-text query (0..1).
 * Cheap: prefix > substring > char-overlap. No external fuzzy lib needed at this volume.
 */
function scoreEntry(entry: ServiceCatalogueEntry, q: string): number {
  if (!q) return 0;
  const haystacks: Array<{ text: string; weight: number }> = [
    { text: entry.name, weight: 1 },
    { text: entry.id, weight: 0.9 },
    ...(entry.aliases ?? []).map((a) => ({ text: a, weight: 0.85 })),
    ...(entry.domain ? [{ text: entry.domain, weight: 0.8 }] : []),
    { text: entry.description, weight: 0.35 },
  ];
  let best = 0;
  for (const { text, weight } of haystacks) {
    const t = text.toLowerCase();
    let s = 0;
    if (t === q) s = 1;
    else if (t.startsWith(q)) s = 0.9;
    else if (t.includes(q)) s = 0.7;
    else s = charOverlap(t, q);
    const weighted = s * weight;
    if (weighted > best) best = weighted;
  }
  return best;
}

/** How many characters of `q` appear in `t`, in order? Cheap levenshtein substitute. */
function charOverlap(t: string, q: string): number {
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    if (i === q.length) break;
  }
  return q.length ? (i / q.length) * 0.5 : 0;
}

export interface SearchServicesOptions {
  limit?: number;
  includeMcpRegistry?: boolean;
}

/**
 * Search the catalogue (and optionally the live MCP registry) for services
 * matching `query`. Merges MCP registry hits into catalogue entries by name
 * so we don't double-count. Appends a synthetic "custom service" row when
 * nothing matches well.
 */
export async function searchServices(
  query: string,
  options: SearchServicesOptions = {},
): Promise<ServiceSearchResult[]> {
  const { limit = 10, includeMcpRegistry = true } = options;
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored: ServiceSearchResult[] = [];
  for (const entry of SERVICE_CATALOGUE) {
    const score = scoreEntry(entry, q);
    if (score >= MATCH_THRESHOLD) {
      scored.push({ entry, isCustom: false, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  let mcpResults: McpRegistrySearchResult[] = [];
  if (includeMcpRegistry) {
    try {
      mcpResults = await searchMcpRegistry(query, 10);
    } catch (err) {
      console.error("[service-search] MCP registry failure (ignored):", err);
    }
  }

  // Merge: if a catalogue entry and MCP registry hit share a name, keep the
  // catalogue entry (it's richer). Otherwise add the MCP hit as its own result.
  const catalogueNames = new Set(scored.map((r) => r.entry!.name.toLowerCase()));
  for (const mcp of mcpResults) {
    if (!mcp.name || catalogueNames.has(mcp.name.toLowerCase())) continue;
    scored.push({
      entry: null,
      mcpRegistry: mcp,
      isCustom: false,
      score: mcp.verified ? 0.6 : 0.45,
    });
  }
  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, limit);
  const bestScore = top[0]?.score ?? 0;
  if (bestScore < CUSTOM_THRESHOLD) {
    top.push({ entry: null, isCustom: true, score: 0 });
  }
  return top;
}

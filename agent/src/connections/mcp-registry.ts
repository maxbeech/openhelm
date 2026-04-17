import type { McpRegistrySearchResult } from "@openhelm/shared";

const REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0/servers";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** First-party / verified publisher namespaces — shown first in search results */
const FIRST_PARTY_NAMESPACES = new Set([
  "io.modelcontextprotocol",
  "com.anthropic",
  "com.notion",
  "com.github",
  "com.slack",
  "com.linear",
  "com.sentry",
  "com.supabase",
  "com.pipedream",
]);

interface CacheEntry {
  results: McpRegistrySearchResult[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function isVerified(namespace: string): boolean {
  return FIRST_PARTY_NAMESPACES.has(namespace.split("/")[0]);
}

/** Query the official MCP registry with a 15-min LRU-style cache */
export async function searchMcpRegistry(
  query: string,
  limit = 20,
): Promise<McpRegistrySearchResult[]> {
  const cacheKey = `${query}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.results;

  try {
    const url = new URL(REGISTRY_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));

    const resp = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) throw new Error(`MCP registry returned ${resp.status}`);

    const data = await resp.json() as { servers?: Array<Record<string, unknown>> };
    const servers = data.servers ?? [];

    const results: McpRegistrySearchResult[] = servers.map((s) => {
      const namespace = String(s.namespace ?? s.id ?? "");
      return {
        id: String(s.id ?? s.name ?? ""),
        name: String(s.displayName ?? s.name ?? ""),
        namespace,
        description: String(s.description ?? ""),
        version: s.version ? String(s.version) : undefined,
        verified: isVerified(namespace),
        transports: Array.isArray(s.transports) ? s.transports.map(String) : ["stdio"],
        oauthRequired: !!s.auth,
        installCommand: s.packages
          ? getInstallCommand(s.packages as Record<string, unknown>[])
          : undefined,
        iconUrl: s.logoUrl ? String(s.logoUrl) : undefined,
      };
    });

    // Sort: verified (first-party) first
    results.sort((a, b) => (b.verified ? 1 : 0) - (a.verified ? 1 : 0));

    cache.set(cacheKey, { results, expiresAt: Date.now() + CACHE_TTL_MS });
    return results;
  } catch (err) {
    console.error("[mcp-registry] search error (returning empty):", err);
    // Return first-party catalogue as fallback
    return getFirstPartyCatalogue().filter(
      (s) => s.name.toLowerCase().includes(query.toLowerCase()),
    );
  }
}

function getInstallCommand(packages: Record<string, unknown>[]): string[] | undefined {
  const npmPkg = packages.find((p) => p.registry === "npm");
  if (npmPkg?.package) return ["npx", "-y", String(npmPkg.package)];
  const pyPkg = packages.find((p) => p.registry === "pypi");
  if (pyPkg?.package) return ["uvx", String(pyPkg.package)];
  return undefined;
}

/** Hard-coded first-party servers shown as fallback when registry is unavailable */
function getFirstPartyCatalogue(): McpRegistrySearchResult[] {
  return [
    { id: "github-mcp-server", name: "GitHub", namespace: "com.github", description: "Official GitHub MCP server", verified: true, transports: ["stdio"], oauthRequired: true, installCommand: ["npx", "-y", "@modelcontextprotocol/server-github"] },
    { id: "notion-mcp", name: "Notion", namespace: "com.notion", description: "Official Notion MCP server", verified: true, transports: ["stdio"], oauthRequired: true, installCommand: ["npx", "-y", "@notionhq/mcp"] },
    { id: "slack-mcp", name: "Slack", namespace: "com.slack", description: "Official Slack MCP server", verified: true, transports: ["stdio"], oauthRequired: true, installCommand: ["npx", "-y", "@slack/mcp-server"] },
    { id: "sentry-mcp", name: "Sentry", namespace: "com.sentry", description: "Official Sentry MCP server", verified: true, transports: ["stdio"], oauthRequired: true, installCommand: ["uvx", "sentry-mcp"] },
    { id: "supabase-mcp", name: "Supabase", namespace: "com.supabase", description: "Official Supabase MCP server", verified: true, transports: ["stdio"], oauthRequired: true, installCommand: ["npx", "-y", "@supabase/mcp-server-supabase@latest"] },
    { id: "linear-mcp", name: "Linear", namespace: "com.linear", description: "Official Linear MCP server", verified: true, transports: ["http"], oauthRequired: true, installCommand: [] },
    { id: "pipedream-mcp", name: "Pipedream", namespace: "com.pipedream", description: "Official Pipedream MCP server", verified: true, transports: ["http"], oauthRequired: true, installCommand: [] },
  ];
}

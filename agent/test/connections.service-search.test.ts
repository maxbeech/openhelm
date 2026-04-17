import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the MCP registry module so we control what it returns and don't hit the network.
vi.mock("../src/connections/mcp-registry.js", () => ({
  searchMcpRegistry: vi.fn(async () => []),
}));

import { searchServices } from "../src/connections/service-search.js";
import { searchMcpRegistry } from "../src/connections/mcp-registry.js";

beforeEach(() => {
  vi.mocked(searchMcpRegistry).mockReset();
  vi.mocked(searchMcpRegistry).mockResolvedValue([]);
});

describe("service-search", () => {
  it("matches catalogue entries on name", async () => {
    const results = await searchServices("notion");
    const hit = results.find((r) => r.entry?.id === "notion");
    expect(hit).toBeDefined();
    expect(hit!.entry!.name).toBe("Notion");
    expect(hit!.isCustom).toBe(false);
  });

  it("matches on alias and on domain", async () => {
    const byAlias = await searchServices("ghd");
    expect(byAlias.length).toBeGreaterThan(0);

    const byDomain = await searchServices("figma.com");
    const hit = byDomain.find((r) => r.entry?.id === "figma");
    expect(hit).toBeDefined();
  });

  it("appends a custom-service row when nothing matches well", async () => {
    const results = await searchServices("zzzqwerty");
    const hasCustom = results.some((r) => r.isCustom);
    expect(hasCustom).toBe(true);
  });

  it("does not append a custom-service row for strong matches", async () => {
    const results = await searchServices("github");
    const hasCustom = results.some((r) => r.isCustom);
    expect(hasCustom).toBe(false);
  });

  it("merges MCP registry hits, deduping by name", async () => {
    vi.mocked(searchMcpRegistry).mockResolvedValue([
      { id: "com.notion/mcp", name: "Notion", namespace: "com.notion", description: "dup", verified: true, transports: ["stdio"], oauthRequired: true },
      { id: "com.fictional/mcp", name: "Fictional", namespace: "com.fictional", description: "only in registry", verified: true, transports: ["stdio"], oauthRequired: true },
    ]);
    const results = await searchServices("notion");
    const notionCount = results.filter((r) =>
      r.entry?.id === "notion" || r.mcpRegistry?.name === "Notion"
    ).length;
    // Only the catalogue row — the registry dup is folded out.
    expect(notionCount).toBe(1);
  });

  it("returns empty array for whitespace query", async () => {
    const results = await searchServices("   ");
    expect(results).toEqual([]);
  });
});

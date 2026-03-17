import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "../src/memory/embeddings.js";
import { buildMemorySection, buildChatMemorySection } from "../src/memory/prompt-builder.js";
import type { ScoredMemory } from "../src/memory/retriever.js";
import type { Memory } from "@openorchestra/shared";

function makeMem(overrides: Partial<Memory>): Memory {
  return {
    id: "test-id",
    projectId: "proj",
    goalId: null,
    jobId: null,
    type: "semantic",
    content: "Test content",
    sourceType: "user",
    sourceId: null,
    importance: 5,
    accessCount: 0,
    lastAccessedAt: null,
    tags: [],
    isArchived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("cosineSimilarity", () => {
  it("returns 1 for identical normalized vectors", () => {
    const v = [0.5, 0.5, 0.5, 0.5];
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    const normalized = v.map((x) => x / norm);
    expect(cosineSimilarity(normalized, normalized)).toBeCloseTo(1.0, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = [1, 0, 0, 0];
    const b = [0, 1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it("returns 0 for different length vectors", () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });
});

describe("buildMemorySection", () => {
  it("returns empty string for no memories", () => {
    expect(buildMemorySection([])).toBe("");
  });

  it("groups memories by type with headers", () => {
    const scored: ScoredMemory[] = [
      { memory: makeMem({ type: "semantic", content: "Uses React 18" }), score: 0.8 },
      { memory: makeMem({ type: "procedural", content: "Deploy via CLI" }), score: 0.7 },
      { memory: makeMem({ type: "semantic", content: "Has TypeScript" }), score: 0.6 },
    ];

    const result = buildMemorySection(scored);
    expect(result).toContain("## Relevant Context (from memory)");
    expect(result).toContain("### Facts");
    expect(result).toContain("- Uses React 18");
    expect(result).toContain("- Has TypeScript");
    expect(result).toContain("### Workflows");
    expect(result).toContain("- Deploy via CLI");
  });

  it("orders sections by type order", () => {
    const scored: ScoredMemory[] = [
      { memory: makeMem({ type: "episodic", content: "API broke" }), score: 0.8 },
      { memory: makeMem({ type: "semantic", content: "Uses Node" }), score: 0.7 },
    ];

    const result = buildMemorySection(scored);
    const factsIdx = result.indexOf("### Facts");
    const insightsIdx = result.indexOf("### Previous Run Insights");
    expect(factsIdx).toBeLessThan(insightsIdx);
  });
});

describe("buildChatMemorySection", () => {
  it("returns empty string for no memories", () => {
    expect(buildChatMemorySection([])).toBe("");
  });

  it("includes type prefix in bullets", () => {
    const scored: ScoredMemory[] = [
      { memory: makeMem({ type: "semantic", content: "Uses React" }), score: 0.8 },
    ];

    const result = buildChatMemorySection(scored);
    expect(result).toContain("[semantic] Uses React");
    expect(result).toContain("save_memory");
  });
});

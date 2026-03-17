/**
 * Formats retrieved memories into a structured section for prompt injection.
 * Groups memories by type with clear headers.
 */

import type { ScoredMemory } from "./retriever.js";
import type { MemoryType } from "@openorchestra/shared";

const TYPE_HEADERS: Record<MemoryType, string> = {
  semantic: "Facts",
  episodic: "Previous Run Insights",
  procedural: "Workflows",
  source: "Data Sources",
};

/** Display order for memory type sections */
const TYPE_ORDER: MemoryType[] = ["semantic", "procedural", "episodic", "source"];

/**
 * Build a formatted memory section to append to a prompt.
 * Returns empty string if no memories provided.
 */
export function buildMemorySection(scored: ScoredMemory[]): string {
  if (scored.length === 0) return "";

  // Group by type
  const groups = new Map<MemoryType, string[]>();
  for (const { memory } of scored) {
    const type = memory.type as MemoryType;
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type)!.push(memory.content);
  }

  const sections: string[] = [];
  for (const type of TYPE_ORDER) {
    const items = groups.get(type);
    if (!items || items.length === 0) continue;
    sections.push(`### ${TYPE_HEADERS[type]}`);
    for (const item of items) {
      sections.push(`- ${item}`);
    }
  }

  if (sections.length === 0) return "";

  return `\n---\n\n## Relevant Context (from memory)\n\n${sections.join("\n")}\n`;
}

/**
 * Build a compact memory section for chat system prompts.
 * Shorter format — just bullets with type prefix.
 */
export function buildChatMemorySection(scored: ScoredMemory[]): string {
  if (scored.length === 0) return "";

  const lines = scored.map(
    ({ memory }) => `- [${memory.type}] ${memory.content}`,
  );

  return `## Project Memory\nRelevant context from previous runs and user input:\n${lines.join("\n")}\n\nUse save_memory when the user shares important information worth remembering.`;
}

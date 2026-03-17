/**
 * Memory retrieval — scores and ranks memories by relevance.
 *
 * Combined score:
 *   0.4 × cosine_similarity + 0.15 × scope_match + 0.15 × importance
 *   + 0.15 × type_weight + 0.15 × recency
 *
 * Minimum threshold: 0.3 — below this, nothing is injected.
 */

import { generateEmbedding, cosineSimilarity } from "./embeddings.js";
import {
  getActiveMemoriesWithEmbeddings,
  touchMemories,
} from "../db/queries/memories.js";
import type { Memory, MemoryType, MemoryRetrievalContext } from "@openorchestra/shared";

export interface ScoredMemory {
  memory: Memory;
  score: number;
}

const SCORE_THRESHOLD = 0.3;
const DEFAULT_MAX_RESULTS = 10;

/** Type weights vary by context — procedural is high for job runs */
const TYPE_WEIGHTS: Record<MemoryType, number> = {
  procedural: 1.0,
  semantic: 0.8,
  episodic: 0.6,
  source: 0.5,
};

/** Recency half-life in days */
const RECENCY_HALF_LIFE_DAYS = 21;

function scopeScore(memory: Memory, ctx: MemoryRetrievalContext): number {
  if (ctx.jobId && memory.jobId === ctx.jobId) return 1.0;
  if (ctx.goalId && memory.goalId === ctx.goalId) return 0.67;
  return 0.33; // project-level match
}

function recencyScore(updatedAt: string): number {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

function importanceScore(importance: number): number {
  // importance is stored as 0-10 integer
  return importance / 10;
}

/**
 * Retrieve relevant memories for a given context.
 * Returns scored memories above the threshold, sorted by score descending.
 * Also bumps access counts on returned memories.
 */
export async function retrieveMemories(
  ctx: MemoryRetrievalContext,
): Promise<ScoredMemory[]> {
  const maxResults = ctx.maxResults ?? DEFAULT_MAX_RESULTS;

  // Get all active memories with embeddings
  const allMemories = getActiveMemoriesWithEmbeddings(ctx.projectId);
  if (allMemories.length === 0) return [];

  // Generate query embedding
  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateEmbedding(ctx.query);
  } catch (err) {
    console.error("[retriever] embedding generation failed:", err);
    return [];
  }

  // Score each memory
  const scored: ScoredMemory[] = [];
  for (const mem of allMemories) {
    const cosine = mem.embedding
      ? cosineSimilarity(queryEmbedding, mem.embedding)
      : 0;
    const scope = scopeScore(mem, ctx);
    const imp = importanceScore(mem.importance);
    const typeW = TYPE_WEIGHTS[mem.type as MemoryType] ?? 0.5;
    const recency = recencyScore(mem.updatedAt);

    const score =
      0.4 * cosine +
      0.15 * scope +
      0.15 * imp +
      0.15 * typeW +
      0.15 * recency;

    if (score >= SCORE_THRESHOLD) {
      scored.push({ memory: mem, score });
    }
  }

  // Sort by score descending and limit
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, maxResults);

  // Bump access counts
  if (top.length > 0) {
    touchMemories(top.map((s) => s.memory.id));
  }

  return top;
}

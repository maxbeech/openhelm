/**
 * Core memory extraction — calls Haiku to analyze content and extract
 * atomic memories with structured JSON output.
 */

import { callLlmViaCli } from "../planner/llm-via-cli.js";
import { extractJson } from "../planner/extract-json.js";
import { MEMORY_EXTRACTION_SCHEMA } from "../planner/schemas.js";
import { createMemory, updateMemory, listMemories, getActiveMemoriesWithEmbeddings } from "../db/queries/memories.js";
import { generateEmbedding, cosineSimilarity } from "./embeddings.js";
import { emit } from "../ipc/emitter.js";
import type { Memory, MemoryType, MemorySourceType } from "@openhelm/shared";

interface ExtractedMemory {
  type: MemoryType;
  content: string;
  importance: number;
  tags: string[];
  action: "create" | "update" | "merge" | "ignore";
  mergeTargetId?: string | null;
}

const EXTRACTION_SYSTEM_PROMPT = `You extract atomic memories from text for a project management system called OpenHelm.

Given content (run output, goal description, job prompt), extract memories that would be useful for future LLM operations on this project.

Deduplication (CRITICAL — read this first):
- You will be given a list of existing memories. Before creating ANY new memory, check if an existing memory already covers the same idea.
- If an existing memory already captures the information — even in slightly different words — use action "ignore" instead of creating a duplicate.
- Use "update" (with mergeTargetId!) ONLY when the existing memory has stale or incomplete information and the new content is a clear improvement. NEVER return "update" without providing a mergeTargetId.
- Use "merge" (with mergeTargetId!) ONLY when two related ideas should be consolidated into one.
- Use "create" ONLY for genuinely novel information not captured by any existing memory.
- When in doubt between "create" and "ignore", choose "ignore". Fewer high-quality memories are better than many redundant ones.
- Quality over quantity — 0-2 new memories per extraction is typical. An empty array is normal when existing memories already cover the content.

Rules:
- Each memory must be a single atomic idea (1-2 sentences max)
- Prefer data-source pointers over copying large data
- Use default tags when applicable: goal, data-source, preference, workflow, error-pattern, tool-usage, architecture, convention
- Create custom tags sparingly
- Importance scale: 8-10 critical facts, 5-7 useful context, 1-4 observations (on 0-10 scale)
- Return an empty memories array if the content lacks useful information OR if all useful information is already captured in existing memories
- Prefer actionable insights over trivial observations — do NOT extract information that restates what existing memories already say

For run outputs, look especially for:
- Error patterns and their solutions (tag: error-pattern)
- Workflow optimizations discovered during execution (tag: workflow)
- Tool/API usage patterns — rate limits, auth requirements, endpoints (tag: tool-usage)
- Environmental facts about external services (tag: data-source)
- Correction notes that proved effective or ineffective (tag: error-pattern)`;

export interface ExtractionContext {
  projectId: string;
  goalId?: string;
  jobId?: string;
  sourceType: MemorySourceType;
  sourceId?: string;
  content: string;
}

/**
 * Extract memories from content using Haiku (classification tier).
 * Returns the list of persisted Memory objects.
 */
export async function extractMemories(ctx: ExtractionContext): Promise<Memory[]> {
  // Build semantically-relevant dedup context: show the LLM the most similar existing
  // memories rather than just the most recent ones, so it can make better ignore/update
  // decisions.
  let existingSummary = "";
  const allExisting = getActiveMemoriesWithEmbeddings(ctx.projectId);
  if (allExisting.length > 0) {
    let relevantExisting: typeof allExisting;
    try {
      const contentEmbedding = await generateEmbedding(ctx.content.slice(0, 500));
      const scored = allExisting
        .filter((m) => m.embedding !== null)
        .map((m) => ({ mem: m, sim: cosineSimilarity(contentEmbedding, m.embedding!) }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 30);
      relevantExisting = scored.map((s) => s.mem);
    } catch (err) {
      // Fallback to chronological if embedding fails
      console.error("[extractor] embedding generation failed for dedup context:", err);
      relevantExisting = allExisting.slice(0, 30);
    }
    existingSummary = `\n\nExisting memories (check these — use "ignore" if info is already captured):\n${
      relevantExisting.map((m) => `[${m.id}] (${m.type}) ${m.content}`).join("\n")
    }`;
  }

  const userMessage = `Content to analyze:\n${ctx.content}${existingSummary}`;

  console.error(`[extractor] calling LLM (${ctx.sourceType}, content: ${ctx.content.length} chars, msg: ${userMessage.length} chars)`);
  const rawText = await callLlmViaCli({
    model: "classification",
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    userMessage,
    jsonSchema: MEMORY_EXTRACTION_SCHEMA,
    timeoutMs: 120_000, // 2 minutes — extraction with large logs + json-schema can be slow
  });
  console.error(`[extractor] LLM returned ${rawText.length} chars`);

  let parsed: { memories: ExtractedMemory[] };
  try {
    const jsonStr = extractJson(rawText);
    const outer = JSON.parse(jsonStr);
    // Handle CLI JSON envelope: { type: "result", result: "..." }
    if (outer.result !== undefined && outer.memories === undefined) {
      const inner = typeof outer.result === "string" ? JSON.parse(outer.result) : outer.result;
      parsed = inner;
    } else {
      parsed = outer;
    }
  } catch {
    console.error("[extractor] failed to parse LLM output:", rawText.slice(0, 300));
    emit("memory.extractionFailed", {
      projectId: ctx.projectId,
      source: ctx.sourceType,
      reason: "JSON parse failure",
    });
    return [];
  }

  if (!parsed.memories || !Array.isArray(parsed.memories)) {
    console.error("[extractor] no memories array in response:", JSON.stringify(parsed).slice(0, 200));
    emit("memory.extractionFailed", {
      projectId: ctx.projectId,
      source: ctx.sourceType,
      reason: "Invalid response structure",
    });
    return [];
  }
  console.error(`[extractor] LLM extracted ${parsed.memories.length} candidate memories`);

  const results: Memory[] = [];
  for (const ext of parsed.memories) {
    try {
      const mem = await processExtractedMemory(ext, ctx);
      if (mem) results.push(mem);
    } catch (err) {
      console.error("[extractor] failed to process memory:", err);
    }
  }

  emit("memory.extracted", {
    projectId: ctx.projectId,
    count: results.length,
    source: ctx.sourceType,
  });

  return results;
}

async function processExtractedMemory(
  ext: ExtractedMemory,
  ctx: ExtractionContext,
): Promise<Memory | null> {
  // Clamp importance to 0-10
  const importance = Math.max(0, Math.min(10, Math.round(ext.importance)));

  // Explicit skip — LLM decided info is already captured
  if (ext.action === "ignore") {
    return null;
  }

  if (ext.action === "update" && !ext.mergeTargetId) {
    // The LLM returned action:"update" without a mergeTargetId — skip rather than
    // creating a duplicate. The info will be re-extracted next run with better targeting.
    console.error("[extractor] 'update' action missing mergeTargetId — skipping (not creating duplicate)");
    return null;
  }

  if (ext.action === "update" && ext.mergeTargetId) {
    let embedding: number[] | undefined;
    try { embedding = await generateEmbedding(ext.content); } catch (err) { console.error("[extractor] embedding generation failed (update):", err); }
    const mem = updateMemory(
      { id: ext.mergeTargetId, content: ext.content, importance, tags: ext.tags },
      embedding,
    );
    emit("memory.updated", mem);
    return mem;
  }

  if (ext.action === "merge" && ext.mergeTargetId) {
    // Merge = update target with combined content
    const existing = listMemories({ projectId: ctx.projectId }).find(
      (m) => m.id === ext.mergeTargetId,
    );
    if (existing) {
      const merged = `${existing.content}. ${ext.content}`;
      let embedding: number[] | undefined;
      try { embedding = await generateEmbedding(merged); } catch (err) { console.error("[extractor] embedding generation failed (merge):", err); }
      const mem = updateMemory(
        { id: ext.mergeTargetId, content: merged, importance: Math.max(existing.importance, importance), tags: [...new Set([...existing.tags, ...ext.tags])] },
        embedding,
      );
      emit("memory.updated", mem);
      return mem;
    }
    // Target not found — skip rather than creating a stray duplicate
    console.error(`[extractor] merge target ${ext.mergeTargetId} not found — skipping`);
    return null;
  }

  // Create — but first do a programmatic near-duplicate check.
  // This catches duplicates the LLM missed (e.g. when the dupe is outside the 30-memory
  // context window, or subtle paraphrases).
  let embedding: number[] | undefined;
  try { embedding = await generateEmbedding(ext.content); } catch (err) { console.error("[extractor] embedding generation failed (create):", err); }

  const NEAR_DUPE_THRESHOLD = 0.85;
  if (embedding) {
    const allActive = getActiveMemoriesWithEmbeddings(ctx.projectId);
    for (const candidate of allActive) {
      if (!candidate.embedding) continue;
      const sim = cosineSimilarity(embedding, candidate.embedding);
      if (sim >= NEAR_DUPE_THRESHOLD) {
        console.error(
          `[extractor] near-duplicate detected (sim=${sim.toFixed(3)}) with memory ${candidate.id} — ` +
          `"${candidate.content.slice(0, 80)}"`,
        );
        if (importance > candidate.importance) {
          // New content is more important — update the existing memory
          const updated = updateMemory(
            { id: candidate.id, content: ext.content, importance, tags: [...new Set([...candidate.tags, ...ext.tags])] },
            embedding,
          );
          emit("memory.updated", updated);
          return updated;
        }
        // Existing memory is adequate — skip
        return null;
      }
    }
  }

  const mem = createMemory(
    {
      projectId: ctx.projectId,
      goalId: ctx.goalId,
      jobId: ctx.jobId,
      type: ext.type,
      content: ext.content,
      sourceType: ctx.sourceType,
      sourceId: ctx.sourceId,
      importance,
      tags: ext.tags,
    },
    embedding,
  );
  emit("memory.created", mem);
  return mem;
}

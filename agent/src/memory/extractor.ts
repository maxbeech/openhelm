/**
 * Core memory extraction — calls Haiku to analyze content and extract
 * atomic memories with structured JSON output.
 */

import { callLlmViaCli } from "../planner/llm-via-cli.js";
import { extractJson } from "../planner/extract-json.js";
import { MEMORY_EXTRACTION_SCHEMA } from "../planner/schemas.js";
import { createMemory, updateMemory, listMemories } from "../db/queries/memories.js";
import { generateEmbedding } from "./embeddings.js";
import { emit } from "../ipc/emitter.js";
import type { Memory, MemoryType, MemorySourceType } from "@openorchestra/shared";

interface ExtractedMemory {
  type: MemoryType;
  content: string;
  importance: number;
  tags: string[];
  action: "create" | "update" | "merge";
  mergeTargetId?: string | null;
}

const EXTRACTION_SYSTEM_PROMPT = `You extract atomic memories from text for a project management system called OpenOrchestra.

Given content (run output, goal description, job prompt), extract memories that would be useful for future LLM operations on this project.

Rules:
- Each memory must be a single atomic idea (1-2 sentences max)
- Prefer data-source pointers over copying large data
- Use default tags when applicable: goal, data-source, preference, workflow, error-pattern, tool-usage, architecture, convention
- Create custom tags sparingly
- Importance scale: 8-10 critical facts, 5-7 useful context, 1-4 observations (on 0-10 scale)
- For "update": replace stale content with fresh version (provide content of the updated memory)
- For "merge": combine with an existing memory (provide mergeTargetId)
- Return an empty memories array only if content is genuinely devoid of useful information
- Prefer actionable insights over trivial observations

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
  // Get existing memories for deduplication
  const existing = listMemories({ projectId: ctx.projectId, isArchived: false });
  const existingSummary = existing.length > 0
    ? `\n\nExisting memories (for dedup/merge):\n${existing.slice(0, 30).map((m) => `[${m.id}] (${m.type}) ${m.content}`).join("\n")}`
    : "";

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
    return [];
  }

  if (!parsed.memories || !Array.isArray(parsed.memories)) {
    console.error("[extractor] no memories array in response:", JSON.stringify(parsed).slice(0, 200));
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

  if (results.length > 0) {
    emit("memory.extracted", {
      projectId: ctx.projectId,
      count: results.length,
      source: ctx.sourceType,
    });
  }

  return results;
}

async function processExtractedMemory(
  ext: ExtractedMemory,
  ctx: ExtractionContext,
): Promise<Memory | null> {
  // Clamp importance to 0-10
  const importance = Math.max(0, Math.min(10, Math.round(ext.importance)));

  if (ext.action === "update" && ext.mergeTargetId) {
    let embedding: number[] | undefined;
    try { embedding = await generateEmbedding(ext.content); } catch { /* skip */ }
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
      try { embedding = await generateEmbedding(merged); } catch { /* skip */ }
      const mem = updateMemory(
        { id: ext.mergeTargetId, content: merged, importance: Math.max(existing.importance, importance), tags: [...new Set([...existing.tags, ...ext.tags])] },
        embedding,
      );
      emit("memory.updated", mem);
      return mem;
    }
    // Fall through to create if target not found
  }

  // Create
  let embedding: number[] | undefined;
  try { embedding = await generateEmbedding(ext.content); } catch { /* skip */ }
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

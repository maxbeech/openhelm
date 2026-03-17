import { registerHandler } from "../handler.js";
import { emit } from "../emitter.js";
import * as memQueries from "../../db/queries/memories.js";
import { generateEmbedding } from "../../memory/embeddings.js";
import { retrieveMemories } from "../../memory/retriever.js";
import type {
  CreateMemoryParams,
  UpdateMemoryParams,
  ListMemoriesParams,
  MemoryRetrievalContext,
} from "@openorchestra/shared";

export function registerMemoryHandlers() {
  registerHandler("memories.list", (params) => {
    const p = params as ListMemoriesParams;
    if (!p?.projectId) throw new Error("projectId is required");
    return memQueries.listMemories(p);
  });

  registerHandler("memories.get", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const mem = memQueries.getMemory(id);
    if (!mem) throw new Error(`Memory not found: ${id}`);
    return mem;
  });

  registerHandler("memories.create", async (params) => {
    const p = params as CreateMemoryParams;
    if (!p?.projectId) throw new Error("projectId is required");
    if (!p?.content) throw new Error("content is required");
    if (!p?.type) throw new Error("type is required");

    let embedding: number[] | undefined;
    try {
      embedding = await generateEmbedding(p.content);
    } catch (err) {
      console.error("[memories] embedding generation failed:", err);
    }

    const mem = memQueries.createMemory(p, embedding);
    emit("memory.created", mem);
    return mem;
  });

  registerHandler("memories.update", async (params) => {
    const p = params as UpdateMemoryParams;
    if (!p?.id) throw new Error("id is required");

    let embedding: number[] | undefined;
    if (p.content) {
      try {
        embedding = await generateEmbedding(p.content);
      } catch (err) {
        console.error("[memories] embedding generation failed:", err);
      }
    }

    const mem = memQueries.updateMemory(p, embedding);
    emit("memory.updated", mem);
    return mem;
  });

  registerHandler("memories.delete", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const deleted = memQueries.deleteMemory(id);
    if (deleted) emit("memory.deleted", { id });
    return { deleted };
  });

  registerHandler("memories.archive", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const mem = memQueries.archiveMemory(id);
    emit("memory.updated", mem);
    return mem;
  });

  registerHandler("memories.search", async (params) => {
    const p = params as { projectId: string; query: string };
    if (!p?.projectId) throw new Error("projectId is required");
    if (!p?.query) throw new Error("query is required");
    const ctx: MemoryRetrievalContext = {
      projectId: p.projectId,
      query: p.query,
    };
    const scored = await retrieveMemories(ctx);
    return scored.map((s) => s.memory);
  });

  registerHandler("memories.listTags", (params) => {
    const { projectId } = params as { projectId: string };
    if (!projectId) throw new Error("projectId is required");
    return memQueries.listTags(projectId);
  });

  registerHandler("memories.prune", async (params) => {
    // Lazy-import pruner to avoid circular deps
    const { pruneProject } = await import("../../memory/pruner.js");
    const { projectId } = params as { projectId: string };
    if (!projectId) throw new Error("projectId is required");
    const pruned = pruneProject(projectId);
    return { pruned };
  });

  registerHandler("memories.count", (params) => {
    const { projectId } = params as { projectId?: string };
    if (!projectId) throw new Error("projectId is required");
    return { count: memQueries.countActiveMemories(projectId) };
  });

  registerHandler("memories.listForRun", (params) => {
    const { runId } = params as { runId: string };
    if (!runId) throw new Error("runId is required");
    return memQueries.listMemoriesForRun(runId);
  });

  // Cross-project handlers (All Projects mode)
  registerHandler("memories.listAll", (params) => {
    const p = params as Omit<ListMemoriesParams, "projectId"> | undefined;
    return memQueries.listAllMemories(p);
  });

  registerHandler("memories.listAllTags", () => {
    return memQueries.listAllTags();
  });

  registerHandler("memories.countAll", () => {
    return { count: memQueries.countAllActiveMemories() };
  });
}

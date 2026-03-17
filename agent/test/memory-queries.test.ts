import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../src/db/init.js";
import {
  createMemory,
  getMemory,
  listMemories,
  updateMemory,
  deleteMemory,
  archiveMemory,
  touchMemories,
  countActiveMemories,
  listTags,
  saveRunMemories,
  listMemoriesForRun,
  getActiveMemoriesWithEmbeddings,
  archiveMemories,
  listAllMemories,
  countAllActiveMemories,
  listAllTags,
} from "../src/db/queries/memories.js";
import { createProject } from "../src/db/queries/projects.js";
import { createRun } from "../src/db/queries/runs.js";
import { createJob } from "../src/db/queries/jobs.js";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";

function setupTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "oo-mem-test-"));
  initDatabase(join(dir, "test.db"));
}

function createTestProject() {
  return createProject({ name: "Test Project", directoryPath: "/tmp/test" });
}

describe("Memory Queries", () => {
  beforeEach(() => setupTestDb());

  it("creates and retrieves a memory", () => {
    const project = createTestProject();
    const mem = createMemory({
      projectId: project.id,
      type: "semantic",
      content: "Uses Next.js 14",
      sourceType: "user",
      importance: 8,
      tags: ["architecture"],
    });

    expect(mem.id).toBeTruthy();
    expect(mem.content).toBe("Uses Next.js 14");
    expect(mem.type).toBe("semantic");
    expect(mem.importance).toBe(8);
    expect(mem.tags).toEqual(["architecture"]);
    expect(mem.isArchived).toBe(false);

    const fetched = getMemory(mem.id);
    expect(fetched).toEqual(mem);
  });

  it("lists memories with filters", () => {
    const project = createTestProject();
    createMemory({ projectId: project.id, type: "semantic", content: "Fact 1", sourceType: "user", tags: ["architecture"] });
    createMemory({ projectId: project.id, type: "episodic", content: "Experience 1", sourceType: "run", tags: ["error-pattern"] });
    createMemory({ projectId: project.id, type: "semantic", content: "Fact 2", sourceType: "user", tags: ["architecture"] });

    const all = listMemories({ projectId: project.id });
    expect(all).toHaveLength(3);

    const semanticOnly = listMemories({ projectId: project.id, type: "semantic" });
    expect(semanticOnly).toHaveLength(2);

    const archTag = listMemories({ projectId: project.id, tag: "architecture" });
    expect(archTag).toHaveLength(2);

    const searched = listMemories({ projectId: project.id, search: "experience" });
    expect(searched).toHaveLength(1);
  });

  it("updates a memory", () => {
    const project = createTestProject();
    const mem = createMemory({ projectId: project.id, type: "semantic", content: "Old", sourceType: "user" });

    const updated = updateMemory({ id: mem.id, content: "New content", importance: 9 });
    expect(updated.content).toBe("New content");
    expect(updated.importance).toBe(9);
  });

  it("deletes a memory", () => {
    const project = createTestProject();
    const mem = createMemory({ projectId: project.id, type: "semantic", content: "Delete me", sourceType: "user" });

    const deleted = deleteMemory(mem.id);
    expect(deleted).toBe(true);
    expect(getMemory(mem.id)).toBeNull();
  });

  it("archives a memory", () => {
    const project = createTestProject();
    const mem = createMemory({ projectId: project.id, type: "semantic", content: "Archive me", sourceType: "user" });

    const archived = archiveMemory(mem.id);
    expect(archived.isArchived).toBe(true);

    // Excluded from non-archived list
    const active = listMemories({ projectId: project.id, isArchived: false });
    expect(active).toHaveLength(0);
  });

  it("touches memories (bump access count)", () => {
    const project = createTestProject();
    const mem = createMemory({ projectId: project.id, type: "semantic", content: "Touch me", sourceType: "user" });

    touchMemories([mem.id]);
    const fetched = getMemory(mem.id);
    expect(fetched!.accessCount).toBe(1);
    expect(fetched!.lastAccessedAt).toBeTruthy();
  });

  it("counts active memories", () => {
    const project = createTestProject();
    createMemory({ projectId: project.id, type: "semantic", content: "A", sourceType: "user" });
    createMemory({ projectId: project.id, type: "semantic", content: "B", sourceType: "user" });

    expect(countActiveMemories(project.id)).toBe(2);

    // Archive one
    const mems = listMemories({ projectId: project.id });
    archiveMemory(mems[0].id);
    expect(countActiveMemories(project.id)).toBe(1);
  });

  it("lists tags", () => {
    const project = createTestProject();
    createMemory({ projectId: project.id, type: "semantic", content: "A", sourceType: "user", tags: ["architecture", "convention"] });
    createMemory({ projectId: project.id, type: "semantic", content: "B", sourceType: "user", tags: ["workflow", "architecture"] });

    const tags = listTags(project.id);
    expect(tags).toEqual(["architecture", "convention", "workflow"]);
  });

  it("stores and retrieves run-memory associations", () => {
    const project = createTestProject();
    const job = createJob({
      projectId: project.id,
      name: "Test Job",
      prompt: "Do stuff",
      scheduleType: "manual",
      scheduleConfig: {},
    });
    const run = createRun({ jobId: job.id, triggerSource: "manual" });
    const mem1 = createMemory({ projectId: project.id, type: "semantic", content: "Mem 1", sourceType: "user" });
    const mem2 = createMemory({ projectId: project.id, type: "procedural", content: "Mem 2", sourceType: "user" });

    saveRunMemories(run.id, [mem1.id, mem2.id]);

    const forRun = listMemoriesForRun(run.id);
    expect(forRun).toHaveLength(2);
    expect(forRun.map(m => m.id).sort()).toEqual([mem1.id, mem2.id].sort());
  });

  it("creates memory with embedding", () => {
    const project = createTestProject();
    const embedding = Array(384).fill(0.1);
    const mem = createMemory(
      { projectId: project.id, type: "semantic", content: "With embedding", sourceType: "user" },
      embedding,
    );

    const withEmb = getActiveMemoriesWithEmbeddings(project.id);
    expect(withEmb).toHaveLength(1);
    expect(withEmb[0].embedding).toEqual(embedding);
  });

  it("lists all memories across projects", () => {
    const proj1 = createProject({ name: "P1", directoryPath: "/tmp/p1" });
    const proj2 = createProject({ name: "P2", directoryPath: "/tmp/p2" });
    createMemory({ projectId: proj1.id, type: "semantic", content: "A", sourceType: "user", tags: ["arch"] });
    createMemory({ projectId: proj2.id, type: "episodic", content: "B", sourceType: "run", tags: ["error"] });
    createMemory({ projectId: proj1.id, type: "semantic", content: "C", sourceType: "user", tags: ["arch"] });

    const all = listAllMemories();
    expect(all).toHaveLength(3);

    const semanticOnly = listAllMemories({ type: "semantic" });
    expect(semanticOnly).toHaveLength(2);

    const withTag = listAllMemories({ tag: "error" });
    expect(withTag).toHaveLength(1);

    const searched = listAllMemories({ search: "B" });
    expect(searched).toHaveLength(1);
  });

  it("counts all active memories across projects", () => {
    const proj1 = createProject({ name: "P1", directoryPath: "/tmp/p1" });
    const proj2 = createProject({ name: "P2", directoryPath: "/tmp/p2" });
    createMemory({ projectId: proj1.id, type: "semantic", content: "A", sourceType: "user" });
    createMemory({ projectId: proj2.id, type: "semantic", content: "B", sourceType: "user" });
    const m3 = createMemory({ projectId: proj1.id, type: "semantic", content: "C", sourceType: "user" });

    expect(countAllActiveMemories()).toBe(3);
    archiveMemory(m3.id);
    expect(countAllActiveMemories()).toBe(2);
  });

  it("lists all tags across projects", () => {
    const proj1 = createProject({ name: "P1", directoryPath: "/tmp/p1" });
    const proj2 = createProject({ name: "P2", directoryPath: "/tmp/p2" });
    createMemory({ projectId: proj1.id, type: "semantic", content: "A", sourceType: "user", tags: ["arch", "conv"] });
    createMemory({ projectId: proj2.id, type: "semantic", content: "B", sourceType: "user", tags: ["workflow", "arch"] });

    const tags = listAllTags();
    expect(tags).toEqual(["arch", "conv", "workflow"]);
  });

  it("batch archives memories", () => {
    const project = createTestProject();
    const m1 = createMemory({ projectId: project.id, type: "semantic", content: "A", sourceType: "user" });
    const m2 = createMemory({ projectId: project.id, type: "semantic", content: "B", sourceType: "user" });
    createMemory({ projectId: project.id, type: "semantic", content: "C", sourceType: "user" });

    archiveMemories([m1.id, m2.id]);
    expect(countActiveMemories(project.id)).toBe(1);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { initDatabase, getDb } from "../src/db/init.js";
import {
  createMemory,
  countActiveMemories,
} from "../src/db/queries/memories.js";
import { createProject } from "../src/db/queries/projects.js";
import { pruneProject } from "../src/memory/pruner.js";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";

function setupTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "oo-prune-test-"));
  initDatabase(join(dir, "test.db"));
}

function createTestProject() {
  return createProject({ name: "Test Project", directoryPath: "/tmp/test" });
}

describe("Memory Pruner", () => {
  beforeEach(() => setupTestDb());

  it("does nothing for fresh memories", () => {
    const project = createTestProject();
    createMemory({ projectId: project.id, type: "semantic", content: "Fresh", sourceType: "user", importance: 8 });

    const archived = pruneProject(project.id);
    expect(archived).toBe(0);
    expect(countActiveMemories(project.id)).toBe(1);
  });

  it("auto-archives old low-importance memories", () => {
    const project = createTestProject();
    const mem = createMemory({
      projectId: project.id,
      type: "semantic",
      content: "Old and unimportant",
      sourceType: "user",
      importance: 1,
    });

    // Backdate the memory to 90 days ago
    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const db = getDb();
    db.run(sql`UPDATE memories SET created_at = ${oldDate}, updated_at = ${oldDate} WHERE id = ${mem.id}`);

    const archived = pruneProject(project.id);
    expect(archived).toBeGreaterThanOrEqual(1);
  });

  it("enforces cap by archiving lowest-scoring memories", () => {
    const project = createTestProject();

    // Create 205 memories to exceed cap of 200
    for (let i = 0; i < 205; i++) {
      createMemory({
        projectId: project.id,
        type: "semantic",
        content: `Memory ${i}`,
        sourceType: "user",
        importance: i < 5 ? 1 : 8, // First 5 have low importance
      });
    }

    expect(countActiveMemories(project.id)).toBe(205);
    const archived = pruneProject(project.id);
    expect(archived).toBeGreaterThanOrEqual(5);
    expect(countActiveMemories(project.id)).toBeLessThanOrEqual(200);
  });
});

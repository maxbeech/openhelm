import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb } from "./helpers.js";
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
} from "../src/db/queries/projects.js";

let cleanup: () => void;

beforeAll(() => {
  cleanup = setupTestDb();
});

afterAll(() => {
  cleanup();
});

describe("project queries", () => {
  it("should create a project", () => {
    const project = createProject({
      name: "Test Project",
      directoryPath: "/tmp/test-project",
    });

    expect(project.id).toBeDefined();
    expect(project.name).toBe("Test Project");
    expect(project.directoryPath).toBe("/tmp/test-project");
    expect(project.description).toBeNull();
    expect(project.createdAt).toBeDefined();
    expect(project.updatedAt).toBeDefined();
  });

  it("should create a project with description", () => {
    const project = createProject({
      name: "Described Project",
      description: "A test project with description",
      directoryPath: "/tmp/described",
    });

    expect(project.description).toBe("A test project with description");
  });

  it("should get a project by id", () => {
    const created = createProject({
      name: "Get Test",
      directoryPath: "/tmp/get-test",
    });

    const fetched = getProject(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.name).toBe("Get Test");
  });

  it("should return null for non-existent project", () => {
    const result = getProject("non-existent-id");
    expect(result).toBeNull();
  });

  it("should list all projects", () => {
    const all = listProjects();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  it("should update a project", () => {
    const created = createProject({
      name: "Before Update",
      directoryPath: "/tmp/update-test",
    });

    const updated = updateProject({
      id: created.id,
      name: "After Update",
      description: "Now with description",
    });

    expect(updated.name).toBe("After Update");
    expect(updated.description).toBe("Now with description");
    expect(updated.directoryPath).toBe("/tmp/update-test");
  });

  it("should throw when updating non-existent project", () => {
    expect(() =>
      updateProject({ id: "non-existent", name: "Fail" }),
    ).toThrow("Project not found");
  });

  it("should delete a project", () => {
    const created = createProject({
      name: "To Delete",
      directoryPath: "/tmp/delete-test",
    });

    expect(deleteProject(created.id)).toBe(true);
    expect(getProject(created.id)).toBeNull();
  });

  it("should return false when deleting non-existent project", () => {
    expect(deleteProject("non-existent")).toBe(false);
  });
});

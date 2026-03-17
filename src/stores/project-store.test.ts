import { describe, it, expect, beforeEach, vi } from "vitest";
import { useProjectStore } from "./project-store";
import type { Project } from "@openorchestra/shared";

const mockProject: Project = {
  id: "p1",
  name: "Test Project",
  description: "A test project",
  directoryPath: "/path/to/project",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

vi.mock("@/lib/api", () => ({
  listProjects: vi.fn().mockResolvedValue([]),
  createProject: vi.fn().mockResolvedValue({
    id: "p-new",
    name: "New Project",
    description: null,
    directoryPath: "/new/path",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  }),
  updateProject: vi.fn().mockResolvedValue({
    id: "p1",
    name: "Updated Project",
    description: "Updated description",
    directoryPath: "/path/to/project",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  }),
  deleteProject: vi.fn().mockResolvedValue({ deleted: true }),
}));

describe("ProjectStore", () => {
  beforeEach(() => {
    useProjectStore.setState({
      projects: [mockProject],
      loading: false,
      error: null,
    });
  });

  it("createProject adds new project to the list", async () => {
    const result = await useProjectStore.getState().createProject({
      name: "New Project",
      directoryPath: "/new/path",
    });
    expect(result.id).toBe("p-new");
    const projects = useProjectStore.getState().projects;
    expect(projects).toHaveLength(2);
    expect(projects.some((p) => p.id === "p-new")).toBe(true);
  });

  it("updateProject updates the correct project in store", async () => {
    const result = await useProjectStore.getState().updateProject({
      id: "p1",
      name: "Updated Project",
      description: "Updated description",
    });
    expect(result.name).toBe("Updated Project");
    const project = useProjectStore.getState().projects.find((p) => p.id === "p1");
    expect(project?.name).toBe("Updated Project");
    expect(project?.description).toBe("Updated description");
  });

  it("updateProject does not affect other projects", async () => {
    const second: Project = { ...mockProject, id: "p2", name: "Second" };
    useProjectStore.setState({ projects: [mockProject, second] });
    await useProjectStore.getState().updateProject({ id: "p1", name: "Updated Project" });
    const secondInStore = useProjectStore.getState().projects.find((p) => p.id === "p2");
    expect(secondInStore?.name).toBe("Second");
  });

  it("deleteProject removes the project from the list", async () => {
    await useProjectStore.getState().deleteProject("p1");
    const projects = useProjectStore.getState().projects;
    expect(projects).toHaveLength(0);
  });

  it("deleteProject does not remove other projects", async () => {
    const second: Project = { ...mockProject, id: "p2", name: "Second" };
    useProjectStore.setState({ projects: [mockProject, second] });
    await useProjectStore.getState().deleteProject("p1");
    const projects = useProjectStore.getState().projects;
    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe("p2");
  });

  it("fetchProjects sets projects and clears loading", async () => {
    await useProjectStore.getState().fetchProjects();
    expect(useProjectStore.getState().loading).toBe(false);
    expect(useProjectStore.getState().projects).toEqual([]);
  });
});

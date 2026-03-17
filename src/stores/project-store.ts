import { create } from "zustand";
import type { Project } from "@openorchestra/shared";
import * as api from "@/lib/api";

interface ProjectState {
  projects: Project[];
  loading: boolean;
  error: string | null;

  fetchProjects: () => Promise<void>;
  createProject: (params: {
    name: string;
    description?: string;
    directoryPath: string;
  }) => Promise<Project>;
  updateProject: (params: {
    id: string;
    name?: string;
    description?: string;
    directoryPath?: string;
  }) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  loading: false,
  error: null,

  fetchProjects: async () => {
    set({ loading: true, error: null });
    try {
      const projects = await api.listProjects();
      set({ projects, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      });
    }
  },

  createProject: async (params) => {
    const project = await api.createProject(params);
    set((s) => ({ projects: [...s.projects, project] }));
    return project;
  },

  updateProject: async (params) => {
    const project = await api.updateProject(params);
    set((s) => ({
      projects: s.projects.map((p) => (p.id === project.id ? project : p)),
    }));
    return project;
  },

  deleteProject: async (id) => {
    await api.deleteProject(id);
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
  },
}));

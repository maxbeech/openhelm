import { create } from "zustand";
import * as api from "@/lib/api";
import type {
  Memory,
  MemoryType,
  CreateMemoryParams,
  UpdateMemoryParams,
} from "@openorchestra/shared";

interface MemoryState {
  memories: Memory[];
  allTags: string[];
  memoryCount: number;
  loading: boolean;
  error: string | null;
  filterType: MemoryType | null;
  filterTag: string | null;
  searchQuery: string;
  showArchived: boolean;

  /** projectId=null means all projects */
  fetchMemories: (projectId: string | null) => Promise<void>;
  fetchTags: (projectId: string | null) => Promise<void>;
  fetchCount: (projectId: string | null) => Promise<void>;
  createMemory: (params: CreateMemoryParams) => Promise<void>;
  updateMemory: (params: UpdateMemoryParams) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  archiveMemory: (id: string) => Promise<void>;
  pruneMemories: (projectId: string) => Promise<number>;

  setFilterType: (type: MemoryType | null) => void;
  setFilterTag: (tag: string | null) => void;
  setSearchQuery: (query: string) => void;
  setShowArchived: (show: boolean) => void;

  addMemoryToStore: (memory: Memory) => void;
  updateMemoryInStore: (memory: Memory) => void;
  removeMemoryFromStore: (id: string) => void;
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  memories: [],
  allTags: [],
  memoryCount: 0,
  loading: false,
  error: null,
  filterType: null,
  filterTag: null,
  searchQuery: "",
  showArchived: false,

  fetchMemories: async (projectId: string | null) => {
    set({ loading: true, error: null });
    try {
      const { filterType, filterTag, searchQuery, showArchived } = get();
      if (projectId) {
        const memories = await api.listMemories({
          projectId,
          type: filterType ?? undefined,
          tag: filterTag ?? undefined,
          search: searchQuery || undefined,
          isArchived: showArchived ? undefined : false,
        });
        set({ memories, loading: false });
      } else {
        // All Projects — fetch from all projects
        const memories = await api.listAllMemories({
          type: filterType ?? undefined,
          tag: filterTag ?? undefined,
          search: searchQuery || undefined,
          isArchived: showArchived ? undefined : false,
        });
        set({ memories, loading: false });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  fetchTags: async (projectId: string | null) => {
    try {
      if (projectId) {
        const allTags = await api.listMemoryTags(projectId);
        set({ allTags });
      } else {
        // All Projects — fetch tags from all projects
        const allTags = await api.listAllMemoryTags();
        set({ allTags });
      }
    } catch {
      // Non-critical
    }
  },

  fetchCount: async (projectId: string | null) => {
    try {
      if (projectId) {
        const { count } = await api.countMemories(projectId);
        set({ memoryCount: count });
      } else {
        const { count } = await api.countAllMemories();
        set({ memoryCount: count });
      }
    } catch {
      // Non-critical
    }
  },

  createMemory: async (params: CreateMemoryParams) => {
    try {
      await api.createMemory(params);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  updateMemory: async (params: UpdateMemoryParams) => {
    try {
      await api.updateMemory(params);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  deleteMemory: async (id: string) => {
    try {
      await api.deleteMemory(id);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  archiveMemory: async (id: string) => {
    try {
      await api.archiveMemory(id);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  pruneMemories: async (projectId: string) => {
    try {
      const { pruned } = await api.pruneMemories(projectId);
      return pruned;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return 0;
    }
  },

  setFilterType: (type) => set({ filterType: type }),
  setFilterTag: (tag) => set({ filterTag: tag }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setShowArchived: (show) => set({ showArchived: show }),

  addMemoryToStore: (memory) => {
    set((s) => ({
      memories: [memory, ...s.memories],
      memoryCount: s.memoryCount + 1,
    }));
  },

  updateMemoryInStore: (memory) => {
    set((s) => ({
      memories: s.memories.map((m) => (m.id === memory.id ? memory : m)),
    }));
  },

  removeMemoryFromStore: (id) => {
    set((s) => ({
      memories: s.memories.filter((m) => m.id !== id),
      memoryCount: Math.max(0, s.memoryCount - 1),
    }));
  },
}));

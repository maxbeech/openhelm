import { create } from "zustand";
import * as api from "@/lib/api";
import type {
  Connection,
  ConnectionType,
  ConnectionWithValue,
  CreateConnectionParams,
  UpdateConnectionParams,
  ListConnectionsByScopeParams,
  McpRegistrySearchResult,
  CliCatalogEntry,
} from "@openhelm/shared";

interface ConnectionState {
  connections: Connection[];
  connectionCount: number;
  loading: boolean;
  error: string | null;
  filterType: ConnectionType | null;
  searchQuery: string;

  fetchConnections: (projectId?: string | null) => Promise<void>;
  fetchForScope: (params: ListConnectionsByScopeParams) => Promise<Connection[]>;
  fetchCount: (projectId?: string | null) => Promise<void>;
  createConnection: (params: CreateConnectionParams) => Promise<Connection>;
  updateConnection: (params: UpdateConnectionParams) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  revealValue: (id: string) => Promise<ConnectionWithValue | null>;

  searchMcpRegistry: (query: string) => Promise<McpRegistrySearchResult[]>;
  searchCliRegistry: (query: string) => Promise<CliCatalogEntry[]>;
  installMcp: (params: { mcpServerId: string; name?: string; installCommand?: string[]; scopes?: Array<{scopeType: string; scopeId: string}> }) => Promise<{ connectionId: string; installStatus: string }>;
  installCli: (cliId: string, scopes?: Array<{scopeType: string; scopeId: string}>) => Promise<{ connectionId: string; installStatus: string }>;
  reinstall: (connectionId: string) => Promise<{ connectionId: string; installStatus: string }>;
  setConnectionToken: (connectionId: string, token: string) => Promise<void>;

  setFilterType: (type: ConnectionType | null) => void;
  setSearchQuery: (query: string) => void;

  addConnectionToStore: (connection: Connection) => void;
  updateConnectionInStore: (connection: Connection) => void;
  removeConnectionFromStore: (id: string) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  connections: [],
  connectionCount: 0,
  loading: false,
  error: null,
  filterType: null,
  searchQuery: "",

  fetchConnections: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const connections = projectId
        ? await api.listConnections({ projectId })
        : await api.listAllConnections();
      set({ connections, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  fetchForScope: async (params) => {
    try {
      return await api.listConnectionsByScope(params);
    } catch {
      return [];
    }
  },

  fetchCount: async (projectId) => {
    try {
      const { count } = projectId
        ? await api.countConnections(projectId)
        : await api.countAllConnections();
      set({ connectionCount: count });
    } catch {
      // Non-critical
    }
  },

  createConnection: async (params) => {
    try {
      return await api.createConnection(params);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  updateConnection: async (params) => {
    try {
      await api.updateConnection(params);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  deleteConnection: async (id) => {
    try {
      await api.deleteConnection(id);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  revealValue: async (id) => {
    try {
      return await api.getConnectionValue(id);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  searchMcpRegistry: async (query) => {
    try {
      return await api.searchMcpRegistry(query);
    } catch {
      return [];
    }
  },

  searchCliRegistry: async (query) => {
    try {
      return await api.searchCliRegistry(query);
    } catch {
      return [];
    }
  },

  installMcp: async (params) => {
    return api.installMcpConnection(params);
  },

  installCli: async (cliId, scopes) => {
    return api.installCliConnection(cliId, scopes);
  },

  reinstall: async (connectionId) => {
    return api.reinstallConnection(connectionId);
  },

  setConnectionToken: async (connectionId, token) => {
    await api.setConnectionToken(connectionId, token);
  },

  setFilterType: (type) => set({ filterType: type }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  addConnectionToStore: (connection) => {
    set((s) => ({
      connections: [connection, ...s.connections],
      connectionCount: s.connectionCount + 1,
    }));
  },

  updateConnectionInStore: (connection) => {
    set((s) => ({
      connections: s.connections.map((c) => (c.id === connection.id ? connection : c)),
    }));
  },

  removeConnectionFromStore: (id) => {
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== id),
      connectionCount: Math.max(0, s.connectionCount - 1),
    }));
  },
}));

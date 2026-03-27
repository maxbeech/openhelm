import { create } from "zustand";
import * as api from "@/lib/api";
import type {
  Credential,
  CredentialType,
  CredentialScope,
  CredentialWithValue,
  CreateCredentialParams,
  UpdateCredentialParams,
  ListCredentialsByScopeParams,
} from "@openhelm/shared";

interface CredentialState {
  credentials: Credential[];
  credentialCount: number;
  loading: boolean;
  error: string | null;
  filterType: CredentialType | null;
  filterScope: CredentialScope | null;

  fetchCredentials: (projectId: string | null) => Promise<void>;
  fetchForScope: (params: ListCredentialsByScopeParams) => Promise<Credential[]>;
  fetchCount: (projectId: string | null) => Promise<void>;
  createCredential: (params: CreateCredentialParams) => Promise<void>;
  updateCredential: (params: UpdateCredentialParams) => Promise<void>;
  deleteCredential: (id: string) => Promise<void>;
  revealValue: (id: string) => Promise<CredentialWithValue | null>;

  setFilterType: (type: CredentialType | null) => void;
  setFilterScope: (scope: CredentialScope | null) => void;

  addCredentialToStore: (credential: Credential) => void;
  updateCredentialInStore: (credential: Credential) => void;
  removeCredentialFromStore: (id: string) => void;
}

export const useCredentialStore = create<CredentialState>((set) => ({
  credentials: [],
  credentialCount: 0,
  loading: false,
  error: null,
  filterType: null,
  filterScope: null,

  fetchCredentials: async (projectId: string | null) => {
    set({ loading: true, error: null });
    try {
      const credentials = projectId
        ? await api.listCredentials({ projectId })
        : await api.listAllCredentials();
      set({ credentials, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  fetchForScope: async (params: ListCredentialsByScopeParams) => {
    try {
      return await api.listCredentialsByScope(params);
    } catch {
      return [];
    }
  },

  fetchCount: async (projectId: string | null) => {
    try {
      const { count } = projectId
        ? await api.countCredentials(projectId)
        : await api.countAllCredentials();
      set({ credentialCount: count });
    } catch {
      // Non-critical
    }
  },

  createCredential: async (params: CreateCredentialParams) => {
    try {
      await api.createCredential(params);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  updateCredential: async (params: UpdateCredentialParams) => {
    try {
      await api.updateCredential(params);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  deleteCredential: async (id: string) => {
    try {
      await api.deleteCredential(id);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  revealValue: async (id: string) => {
    try {
      return await api.getCredentialValue(id);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  setFilterType: (type) => set({ filterType: type }),
  setFilterScope: (scope) => set({ filterScope: scope }),

  addCredentialToStore: (credential) => {
    set((s) => ({
      credentials: [credential, ...s.credentials],
      credentialCount: s.credentialCount + 1,
    }));
  },

  updateCredentialInStore: (credential) => {
    set((s) => ({
      credentials: s.credentials.map((c) => (c.id === credential.id ? credential : c)),
    }));
  },

  removeCredentialFromStore: (id) => {
    set((s) => ({
      credentials: s.credentials.filter((c) => c.id !== id),
      credentialCount: Math.max(0, s.credentialCount - 1),
    }));
  },
}));

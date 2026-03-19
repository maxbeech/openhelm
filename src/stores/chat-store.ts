import { create } from "zustand";
import type { ChatMessage, ChatContext } from "@openhelm/shared";
import * as api from "@/lib/api";
import { friendlyError } from "@/lib/utils";

export const CHAT_MODELS = [
  { value: "haiku", label: "Haiku" },
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
] as const;

export type ChatModelValue = typeof CHAT_MODELS[number]["value"];

export const CHAT_EFFORTS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;

export type ChatEffortValue = typeof CHAT_EFFORTS[number]["value"];

export const CHAT_PERMISSION_MODES = [
  { value: "plan", label: "Read-only", description: "Web search, file read" },
  { value: "auto", label: "Auto", description: "Claude decides" },
  { value: "bypassPermissions", label: "Full access", description: "All tools allowed" },
] as const;

export type ChatPermissionModeValue = typeof CHAT_PERMISSION_MODES[number]["value"];

interface ChatState {
  messages: ChatMessage[];
  loading: boolean;
  sending: boolean;
  error: string | null;
  panelOpen: boolean;
  statusText: string | null;
  chatModel: ChatModelValue;
  chatEffort: ChatEffortValue;
  chatPermissionMode: ChatPermissionModeValue;

  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
  setStatusText: (text: string | null) => void;
  setChatModel: (model: ChatModelValue) => void;
  setChatEffort: (effort: ChatEffortValue) => void;
  setChatPermissionMode: (mode: ChatPermissionModeValue) => void;
  fetchMessages: (projectId: string) => Promise<void>;
  sendMessage: (projectId: string, content: string, context?: ChatContext) => Promise<void>;
  approveAction: (messageId: string, callId: string, projectId: string) => Promise<void>;
  rejectAction: (messageId: string, callId: string) => Promise<void>;
  approveAll: (messageId: string, projectId: string) => Promise<void>;
  rejectAll: (messageId: string) => Promise<void>;
  clearChat: (projectId: string) => Promise<void>;
  addMessageToStore: (message: ChatMessage) => void;
  updateMessageInStore: (message: ChatMessage) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  loading: false,
  sending: false,
  error: null,
  panelOpen: false,
  statusText: null,
  chatModel: "sonnet",
  chatEffort: "medium",
  chatPermissionMode: "plan",

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  setStatusText: (text) => set({ statusText: text }),
  setChatModel: (model) => set({ chatModel: model }),
  setChatEffort: (effort) => set({ chatEffort: effort }),
  setChatPermissionMode: (mode) => set({ chatPermissionMode: mode }),

  fetchMessages: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const messages = await api.listChatMessages({ projectId, limit: 100 });
      set({ messages, loading: false });
    } catch (err) {
      set({ error: friendlyError(err, "Failed to load chat history"), loading: false });
    }
  },

  sendMessage: async (projectId, content, context) => {
    set({ sending: true, error: null });
    const { chatModel, chatEffort, chatPermissionMode } = get();
    try {
      // Optimistically add user message (agent will emit the real one via event)
      await api.sendChatMessage({ projectId, content, context, model: chatModel, modelEffort: chatEffort, permissionMode: chatPermissionMode });
    } catch (err) {
      set({ error: friendlyError(err, "Failed to send message"), sending: false });
      throw err;
    } finally {
      set({ sending: false });
    }
  },

  approveAction: async (messageId, callId, projectId) => {
    try {
      const updated = await api.approveChatAction({ messageId, callId, projectId });
      get().updateMessageInStore(updated);
    } catch (err) {
      set({ error: friendlyError(err, "Failed to approve action") });
      throw err;
    }
  },

  rejectAction: async (messageId, callId) => {
    try {
      const updated = await api.rejectChatAction({ messageId, callId });
      get().updateMessageInStore(updated);
    } catch (err) {
      set({ error: friendlyError(err, "Failed to reject action") });
      throw err;
    }
  },

  approveAll: async (messageId, projectId) => {
    try {
      const updated = await api.approveAllChatActions({ messageId, projectId });
      get().updateMessageInStore(updated);
    } catch (err) {
      set({ error: friendlyError(err, "Failed to approve actions") });
      throw err;
    }
  },

  rejectAll: async (messageId) => {
    try {
      const updated = await api.rejectAllChatActions({ messageId });
      get().updateMessageInStore(updated);
    } catch (err) {
      set({ error: friendlyError(err, "Failed to reject actions") });
      throw err;
    }
  },

  clearChat: async (projectId) => {
    try {
      await api.clearChat({ projectId });
      set({ messages: [] });
    } catch (err) {
      set({ error: friendlyError(err, "Failed to clear chat") });
      throw err;
    }
  },

  addMessageToStore: (message) => {
    set((s) => {
      // Avoid duplicates (event may fire before or after API response)
      if (s.messages.some((m) => m.id === message.id)) return s;
      return { messages: [...s.messages, message] };
    });
  },

  updateMessageInStore: (message) => {
    set((s) => ({
      messages: s.messages.map((m) => (m.id === message.id ? message : m)),
    }));
  },
}));

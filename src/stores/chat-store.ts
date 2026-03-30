import { create } from "zustand";
import type { ChatMessage, ChatContext, Conversation } from "@openhelm/shared";
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

/** Per-conversation transient state (sending, streaming, status). */
export interface ConversationTransientState {
  sending: boolean;
  statusText: string | null;
  streamingText: string;
}

interface ChatState {
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  panelOpen: boolean;
  chatModel: ChatModelValue;
  chatEffort: ChatEffortValue;
  chatPermissionMode: ChatPermissionModeValue;

  /** All conversation threads for the current project */
  conversations: Conversation[];
  /** Currently active conversation thread */
  activeConversationId: string | null;
  /** Remembers last-active conversation per project (projectKey → conversationId) */
  activeConversationIds: Record<string, string>;
  /** Per-conversation transient state for simultaneous threads */
  conversationStates: Record<string, ConversationTransientState>;

  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
  setChatModel: (model: ChatModelValue) => void;
  setChatEffort: (effort: ChatEffortValue) => void;
  setChatPermissionMode: (mode: ChatPermissionModeValue) => void;

  // Per-conversation transient state helpers
  getConvState: (convId: string) => ConversationTransientState;
  setConvSending: (convId: string, sending: boolean) => void;
  setConvStatus: (convId: string, status: string | null) => void;
  appendConvStreaming: (convId: string, text: string) => void;
  clearConvStreaming: (convId: string) => void;

  // Thread management
  fetchConversations: (projectId: string | null) => Promise<void>;
  setActiveConversation: (conversationId: string) => void;
  createThread: (projectId: string | null, title?: string) => Promise<void>;
  renameThread: (conversationId: string, title: string) => Promise<void>;
  deleteThread: (conversationId: string, projectId: string | null) => Promise<void>;
  reorderThreads: (conversationIds: string[]) => Promise<void>;

  // Messages
  fetchMessages: (projectId: string | null, conversationId?: string) => Promise<void>;
  sendMessage: (projectId: string | null, content: string, context?: ChatContext) => Promise<void>;
  approveAction: (messageId: string, callId: string, projectId: string) => Promise<void>;
  rejectAction: (messageId: string, callId: string) => Promise<void>;
  approveAll: (messageId: string, projectId: string) => Promise<void>;
  rejectAll: (messageId: string) => Promise<void>;
  clearChat: (projectId: string | null) => Promise<void>;
  addMessageToStore: (message: ChatMessage) => void;
  updateMessageInStore: (message: ChatMessage) => void;
}

const DEFAULT_CONV_STATE: ConversationTransientState = { sending: false, statusText: null, streamingText: "" };

function projectKey(projectId: string | null): string {
  return projectId ?? "__all__";
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  loading: false,
  error: null,
  panelOpen: false,
  chatModel: "haiku",
  chatEffort: "medium",
  chatPermissionMode: "plan",
  conversations: [],
  activeConversationId: null,
  activeConversationIds: {},
  conversationStates: {},

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  setChatModel: (model) => set({ chatModel: model }),
  setChatEffort: (effort) => set({ chatEffort: effort }),
  setChatPermissionMode: (mode) => set({ chatPermissionMode: mode }),

  getConvState: (convId) => get().conversationStates[convId] ?? DEFAULT_CONV_STATE,
  setConvSending: (convId, sending) => set((s) => ({
    conversationStates: { ...s.conversationStates, [convId]: { ...(s.conversationStates[convId] ?? DEFAULT_CONV_STATE), sending } },
  })),
  setConvStatus: (convId, status) => set((s) => ({
    conversationStates: { ...s.conversationStates, [convId]: { ...(s.conversationStates[convId] ?? DEFAULT_CONV_STATE), statusText: status } },
  })),
  appendConvStreaming: (convId, text) => set((s) => {
    const prev = s.conversationStates[convId] ?? DEFAULT_CONV_STATE;
    return { conversationStates: { ...s.conversationStates, [convId]: { ...prev, streamingText: prev.streamingText + text } } };
  }),
  clearConvStreaming: (convId) => set((s) => ({
    conversationStates: { ...s.conversationStates, [convId]: { ...(s.conversationStates[convId] ?? DEFAULT_CONV_STATE), streamingText: "" } },
  })),

  fetchConversations: async (projectId) => {
    try {
      const convs = await api.listConversations({ projectId });
      const pk = projectKey(projectId);
      const remembered = get().activeConversationIds[pk];
      const activeId = convs.find((c) => c.id === remembered)?.id ?? convs[0]?.id ?? null;
      set({ conversations: convs, activeConversationId: activeId });
      if (activeId) {
        get().fetchMessages(projectId, activeId);
      } else {
        set({ messages: [] });
      }
    } catch {
      set({ conversations: [], activeConversationId: null, messages: [] });
    }
  },

  setActiveConversation: (conversationId) => {
    const conv = get().conversations.find((c) => c.id === conversationId);
    if (!conv) return;
    const pk = projectKey(conv.projectId);
    set((s) => ({
      activeConversationId: conversationId,
      activeConversationIds: { ...s.activeConversationIds, [pk]: conversationId },
    }));
    get().fetchMessages(conv.projectId, conversationId);
  },

  createThread: async (projectId, title) => {
    try {
      const conv = await api.createConversation({ projectId, title });
      set((s) => {
        const pk = projectKey(projectId);
        return {
          conversations: [...s.conversations, conv],
          activeConversationId: conv.id,
          activeConversationIds: { ...s.activeConversationIds, [pk]: conv.id },
          messages: [],
        };
      });
    } catch (err) {
      set({ error: friendlyError(err, "Failed to create thread") });
    }
  },

  renameThread: async (conversationId, title) => {
    try {
      const updated = await api.renameConversation({ conversationId, title });
      set((s) => ({
        conversations: s.conversations.map((c) => (c.id === conversationId ? updated : c)),
      }));
    } catch (err) {
      set({ error: friendlyError(err, "Failed to rename thread") });
    }
  },

  deleteThread: async (conversationId, projectId) => {
    try {
      await api.deleteConversation({ conversationId });
      set((s) => {
        const remaining = s.conversations.filter((c) => c.id !== conversationId);
        const wasActive = s.activeConversationId === conversationId;
        const newActive = wasActive ? (remaining[0]?.id ?? null) : s.activeConversationId;
        return {
          conversations: remaining,
          activeConversationId: newActive,
          messages: wasActive ? [] : s.messages,
        };
      });
      // If we switched active, load the new thread's messages
      const { activeConversationId } = get();
      if (activeConversationId) {
        get().fetchMessages(projectId, activeConversationId);
      }
    } catch (err) {
      set({ error: friendlyError(err, "Failed to delete thread") });
    }
  },

  reorderThreads: async (conversationIds) => {
    // Optimistic reorder
    set((s) => {
      const ordered = conversationIds
        .map((id, i) => {
          const conv = s.conversations.find((c) => c.id === id);
          return conv ? { ...conv, sortOrder: i } : null;
        })
        .filter(Boolean) as Conversation[];
      return { conversations: ordered };
    });
    try {
      await api.reorderConversations({ conversationIds });
    } catch (err) {
      set({ error: friendlyError(err, "Failed to reorder threads") });
    }
  },

  fetchMessages: async (projectId, conversationId) => {
    set({ loading: true, error: null });
    try {
      const cId = conversationId ?? get().activeConversationId ?? undefined;
      const messages = await api.listChatMessages({ projectId, conversationId: cId, limit: 100 });
      set({ messages, loading: false });
    } catch (err) {
      set({ error: friendlyError(err, "Failed to load chat history"), loading: false });
    }
  },

  sendMessage: async (projectId, content, context) => {
    const convId = get().activeConversationId;
    if (convId) get().setConvSending(convId, true);
    set({ error: null });
    const { chatModel, chatEffort, chatPermissionMode } = get();
    try {
      await api.sendChatMessage({
        projectId,
        conversationId: convId ?? undefined,
        content,
        context,
        model: chatModel,
        modelEffort: chatEffort,
        permissionMode: chatPermissionMode,
      });
    } catch (err) {
      if (convId) get().setConvSending(convId, false);
      set({ error: friendlyError(err, "Failed to send message") });
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
      const convId = get().activeConversationId;
      await api.clearChat({ projectId, conversationId: convId ?? undefined });
      set({ messages: [] });
    } catch (err) {
      set({ error: friendlyError(err, "Failed to clear chat") });
      throw err;
    }
  },

  addMessageToStore: (message) => {
    set((s) => {
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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useChatStore } from "./chat-store";
import type { ChatMessage } from "@openhelm/shared";

vi.mock("@/lib/api", () => ({
  listChatMessages: vi.fn(),
  sendChatMessage: vi.fn(),
  approveChatAction: vi.fn(),
  rejectChatAction: vi.fn(),
  approveAllChatActions: vi.fn(),
  rejectAllChatActions: vi.fn(),
  clearChat: vi.fn(),
  listConversations: vi.fn(),
  createConversation: vi.fn(),
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
  reorderConversations: vi.fn(),
}));

import * as api from "@/lib/api";

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    conversationId: "conv-1",
    role: "user",
    content: "Hello",
    toolCalls: null,
    toolResults: null,
    pendingActions: null,
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  useChatStore.setState({
    messages: [],
    loading: false,
    error: null,
    panelOpen: false,
    conversations: [],
    activeConversationId: null,
    activeConversationIds: {},
    conversationStates: {},
  });
  vi.clearAllMocks();
});

describe("panel state", () => {
  it("togglePanel flips panelOpen", () => {
    useChatStore.getState().togglePanel();
    expect(useChatStore.getState().panelOpen).toBe(true);
    useChatStore.getState().togglePanel();
    expect(useChatStore.getState().panelOpen).toBe(false);
  });

  it("openPanel sets panelOpen to true", () => {
    useChatStore.getState().openPanel();
    expect(useChatStore.getState().panelOpen).toBe(true);
  });

  it("closePanel sets panelOpen to false", () => {
    useChatStore.setState({ panelOpen: true });
    useChatStore.getState().closePanel();
    expect(useChatStore.getState().panelOpen).toBe(false);
  });
});

describe("fetchMessages", () => {
  it("loads messages from API into store", async () => {
    const msgs = [makeMessage(), makeMessage({ id: "msg-2", role: "assistant", content: "Hi" })];
    vi.mocked(api.listChatMessages).mockResolvedValue(msgs);

    await useChatStore.getState().fetchMessages("project-1");

    expect(api.listChatMessages).toHaveBeenCalledWith({ projectId: "project-1", conversationId: undefined, limit: 100 });
    expect(useChatStore.getState().messages).toEqual(msgs);
    expect(useChatStore.getState().loading).toBe(false);
  });

  it("sets error on failure", async () => {
    vi.mocked(api.listChatMessages).mockRejectedValue(new Error("network error"));

    await useChatStore.getState().fetchMessages("project-1");

    expect(useChatStore.getState().error).toBeTruthy();
    expect(useChatStore.getState().loading).toBe(false);
  });
});

describe("sendMessage", () => {
  it("calls API and sets per-conversation sending state", async () => {
    useChatStore.setState({ activeConversationId: "conv-1" });
    vi.mocked(api.sendChatMessage).mockResolvedValue({ started: true });

    await useChatStore.getState().sendMessage("project-1", "Hello");

    expect(api.sendChatMessage).toHaveBeenCalledWith({
      projectId: "project-1",
      conversationId: "conv-1",
      content: "Hello",
      context: undefined,
      model: "haiku",
      modelEffort: "medium",
      permissionMode: "plan",
    });
    // sending stays true on the conversation — cleared when assistant message event arrives
    expect(useChatStore.getState().conversationStates["conv-1"]?.sending).toBe(true);
  });

  it("clears per-conversation sending on transport failure", async () => {
    useChatStore.setState({ activeConversationId: "conv-1" });
    vi.mocked(api.sendChatMessage).mockRejectedValue(new Error("send failed"));

    await useChatStore.getState().sendMessage("project-1", "Hi");

    expect(useChatStore.getState().error).toBeTruthy();
    expect(useChatStore.getState().conversationStates["conv-1"]?.sending).toBe(false);
  });
});

describe("approveAction", () => {
  it("updates the message in store after approval", async () => {
    const msg = makeMessage({ id: "msg-pending", role: "assistant", content: "I can do that." });
    useChatStore.setState({ messages: [msg] });

    const approved = { ...msg, pendingActions: [{ callId: "c1", tool: "create_goal", args: {}, description: "d", status: "approved" as const }] };
    vi.mocked(api.approveChatAction).mockResolvedValue(approved);

    await useChatStore.getState().approveAction("msg-pending", "c1", "project-1");

    expect(useChatStore.getState().messages[0].pendingActions![0].status).toBe("approved");
  });

  it("sets error and rethrows on failure", async () => {
    vi.mocked(api.approveChatAction).mockRejectedValue(new Error("approve failed"));

    await expect(
      useChatStore.getState().approveAction("m", "c", "p"),
    ).rejects.toThrow("approve failed");
    expect(useChatStore.getState().error).toBeTruthy();
  });
});

describe("rejectAction", () => {
  it("updates the message in store after rejection", async () => {
    const msg = makeMessage({ id: "msg-reject", role: "assistant" });
    useChatStore.setState({ messages: [msg] });

    const rejected = { ...msg, pendingActions: [{ callId: "c2", tool: "archive_goal", args: {}, description: "d", status: "rejected" as const }] };
    vi.mocked(api.rejectChatAction).mockResolvedValue(rejected);

    await useChatStore.getState().rejectAction("msg-reject", "c2");

    expect(useChatStore.getState().messages[0].pendingActions![0].status).toBe("rejected");
  });
});

describe("approveAll", () => {
  it("updates the message in store after batch approval", async () => {
    const msg = makeMessage({
      id: "msg-batch",
      role: "assistant",
      pendingActions: [
        { callId: "c1", tool: "create_goal", args: {}, description: "d1", status: "pending" },
        { callId: "c2", tool: "create_job", args: {}, description: "d2", status: "pending" },
      ],
    });
    useChatStore.setState({ messages: [msg] });

    const approved = {
      ...msg,
      pendingActions: [
        { callId: "c1", tool: "create_goal", args: {}, description: "d1", status: "approved" as const },
        { callId: "c2", tool: "create_job", args: {}, description: "d2", status: "approved" as const },
      ],
    };
    vi.mocked(api.approveAllChatActions).mockResolvedValue(approved);

    await useChatStore.getState().approveAll("msg-batch", "project-1");

    const stored = useChatStore.getState().messages[0];
    expect(stored.pendingActions!.every((a) => a.status === "approved")).toBe(true);
  });

  it("sets error on failure", async () => {
    vi.mocked(api.approveAllChatActions).mockRejectedValue(new Error("fail"));

    await expect(
      useChatStore.getState().approveAll("m", "p"),
    ).rejects.toThrow("fail");
    expect(useChatStore.getState().error).toBeTruthy();
  });
});

describe("rejectAll", () => {
  it("updates the message in store after batch rejection", async () => {
    const msg = makeMessage({
      id: "msg-rej-all",
      role: "assistant",
      pendingActions: [
        { callId: "c1", tool: "create_goal", args: {}, description: "d1", status: "pending" },
        { callId: "c2", tool: "create_job", args: {}, description: "d2", status: "pending" },
      ],
    });
    useChatStore.setState({ messages: [msg] });

    const rejected = {
      ...msg,
      pendingActions: [
        { callId: "c1", tool: "create_goal", args: {}, description: "d1", status: "rejected" as const },
        { callId: "c2", tool: "create_job", args: {}, description: "d2", status: "rejected" as const },
      ],
    };
    vi.mocked(api.rejectAllChatActions).mockResolvedValue(rejected);

    await useChatStore.getState().rejectAll("msg-rej-all");

    const stored = useChatStore.getState().messages[0];
    expect(stored.pendingActions!.every((a) => a.status === "rejected")).toBe(true);
  });
});

describe("clearChat", () => {
  it("empties messages on success", async () => {
    useChatStore.setState({ messages: [makeMessage()] });
    vi.mocked(api.clearChat).mockResolvedValue(undefined as any);

    await useChatStore.getState().clearChat("project-1");

    expect(useChatStore.getState().messages).toHaveLength(0);
  });

  it("sets error and rethrows on failure", async () => {
    vi.mocked(api.clearChat).mockRejectedValue(new Error("clear failed"));

    await expect(useChatStore.getState().clearChat("p")).rejects.toThrow("clear failed");
    expect(useChatStore.getState().error).toBeTruthy();
  });
});

describe("addMessageToStore", () => {
  it("appends a new message", () => {
    const msg = makeMessage();
    useChatStore.getState().addMessageToStore(msg);
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0].id).toBe("msg-1");
  });

  it("does not add duplicate messages", () => {
    const msg = makeMessage();
    useChatStore.getState().addMessageToStore(msg);
    useChatStore.getState().addMessageToStore(msg);
    expect(useChatStore.getState().messages).toHaveLength(1);
  });
});

describe("updateMessageInStore", () => {
  it("replaces an existing message by ID", () => {
    const msg = makeMessage();
    useChatStore.setState({ messages: [msg] });

    const updated = { ...msg, content: "Updated content" };
    useChatStore.getState().updateMessageInStore(updated);

    expect(useChatStore.getState().messages[0].content).toBe("Updated content");
  });

  it("is a no-op for non-existent message ID", () => {
    const msg = makeMessage();
    useChatStore.setState({ messages: [msg] });

    const other = makeMessage({ id: "other-id", content: "New" });
    useChatStore.getState().updateMessageInStore(other);

    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0].content).toBe("Hello");
  });
});

describe("per-conversation state", () => {
  it("setConvStatus sets and clears per-conversation status", () => {
    useChatStore.getState().setConvStatus("conv-1", "Looking up goals...");
    expect(useChatStore.getState().conversationStates["conv-1"]?.statusText).toBe("Looking up goals...");

    useChatStore.getState().setConvStatus("conv-1", null);
    expect(useChatStore.getState().conversationStates["conv-1"]?.statusText).toBeNull();
  });

  it("appendConvStreaming accumulates text", () => {
    useChatStore.getState().setConvSending("conv-1", true);
    useChatStore.getState().appendConvStreaming("conv-1", "Hello ");
    useChatStore.getState().appendConvStreaming("conv-1", "world");
    expect(useChatStore.getState().conversationStates["conv-1"]?.streamingText).toBe("Hello world");
  });

  it("appendConvStreaming is no-op when sending is false", () => {
    useChatStore.getState().setConvSending("conv-1", false);
    useChatStore.getState().appendConvStreaming("conv-1", "stale text");
    expect(useChatStore.getState().conversationStates["conv-1"]?.streamingText).toBe("");
  });

  it("clearConvStreaming resets streaming text", () => {
    useChatStore.getState().setConvSending("conv-1", true);
    useChatStore.getState().appendConvStreaming("conv-1", "text");
    useChatStore.getState().clearConvStreaming("conv-1");
    expect(useChatStore.getState().conversationStates["conv-1"]?.streamingText).toBe("");
  });
});

describe("thread management", () => {
  it("fetchConversations loads threads and sets active", async () => {
    const convs = [
      { id: "conv-1", projectId: "p1", channel: "app" as const, title: "Thread 1", sortOrder: 0, createdAt: "", updatedAt: "" },
      { id: "conv-2", projectId: "p1", channel: "app" as const, title: "Thread 2", sortOrder: 1, createdAt: "", updatedAt: "" },
    ];
    vi.mocked(api.listConversations).mockResolvedValue(convs);
    vi.mocked(api.listChatMessages).mockResolvedValue([]);

    await useChatStore.getState().fetchConversations("p1");

    expect(useChatStore.getState().conversations).toEqual(convs);
    expect(useChatStore.getState().activeConversationId).toBe("conv-1");
  });

  it("createThread creates and sets as active", async () => {
    const conv = { id: "conv-new", projectId: "p1", channel: "app" as const, title: "New", sortOrder: 0, createdAt: "", updatedAt: "" };
    vi.mocked(api.createConversation).mockResolvedValue(conv);

    await useChatStore.getState().createThread("p1", "New");

    expect(useChatStore.getState().conversations).toContainEqual(conv);
    expect(useChatStore.getState().activeConversationId).toBe("conv-new");
    expect(useChatStore.getState().messages).toHaveLength(0);
  });

  it("deleteThread removes and switches to next", async () => {
    const convs = [
      { id: "conv-1", projectId: "p1", channel: "app" as const, title: "T1", sortOrder: 0, createdAt: "", updatedAt: "" },
      { id: "conv-2", projectId: "p1", channel: "app" as const, title: "T2", sortOrder: 1, createdAt: "", updatedAt: "" },
    ];
    useChatStore.setState({ conversations: convs, activeConversationId: "conv-1" });
    vi.mocked(api.deleteConversation).mockResolvedValue({ deleted: true });
    vi.mocked(api.listChatMessages).mockResolvedValue([]);

    await useChatStore.getState().deleteThread("conv-1", "p1");

    expect(useChatStore.getState().conversations).toHaveLength(1);
    expect(useChatStore.getState().activeConversationId).toBe("conv-2");
  });

  it("renameThread updates the conversation title", async () => {
    const conv = { id: "conv-1", projectId: "p1", channel: "app" as const, title: "Old", sortOrder: 0, createdAt: "", updatedAt: "" };
    useChatStore.setState({ conversations: [conv] });
    const renamed = { ...conv, title: "New Name" };
    vi.mocked(api.renameConversation).mockResolvedValue(renamed);

    await useChatStore.getState().renameThread("conv-1", "New Name");

    expect(useChatStore.getState().conversations[0].title).toBe("New Name");
  });
});

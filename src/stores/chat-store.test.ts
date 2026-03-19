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
  useChatStore.setState({ messages: [], loading: false, sending: false, error: null, panelOpen: false, statusText: null });
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

    expect(api.listChatMessages).toHaveBeenCalledWith({ projectId: "project-1", limit: 100 });
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
  it("calls API and clears sending on success", async () => {
    vi.mocked(api.sendChatMessage).mockResolvedValue(undefined as any);

    await useChatStore.getState().sendMessage("project-1", "Hello");

    expect(api.sendChatMessage).toHaveBeenCalledWith({
      projectId: "project-1",
      content: "Hello",
      context: undefined,
      model: "sonnet",
      modelEffort: "medium",
      permissionMode: "plan",
    });
    expect(useChatStore.getState().sending).toBe(false);
  });

  it("sets error and rethrows on failure", async () => {
    vi.mocked(api.sendChatMessage).mockRejectedValue(new Error("send failed"));

    await expect(
      useChatStore.getState().sendMessage("project-1", "Hi"),
    ).rejects.toThrow("send failed");
    expect(useChatStore.getState().error).toBeTruthy();
    expect(useChatStore.getState().sending).toBe(false);
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

    // Original message unchanged, no new message added
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0].content).toBe("Hello");
  });
});

describe("setStatusText", () => {
  it("sets status text", () => {
    useChatStore.getState().setStatusText("Looking up goals...");
    expect(useChatStore.getState().statusText).toBe("Looking up goals...");
  });

  it("clears status text with null", () => {
    useChatStore.getState().setStatusText("Thinking...");
    useChatStore.getState().setStatusText(null);
    expect(useChatStore.getState().statusText).toBeNull();
  });
});

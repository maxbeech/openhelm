import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import {
  getOrCreateConversation,
  createMessage,
  getMessage,
  updateMessagePendingActions,
  listMessagesForProject,
  clearConversation,
} from "../src/db/queries/conversations.js";

let cleanup: () => void;
let projectId: string;

beforeAll(() => {
  cleanup = setupTestDb();
  const project = createProject({
    name: "Chat Test Project",
    directoryPath: "/tmp/chat-test",
  });
  projectId = project.id;
});

afterAll(() => {
  cleanup();
});

describe("getOrCreateConversation", () => {
  it("creates a new conversation for a project", () => {
    const project = createProject({ name: "Conv Project", directoryPath: "/tmp/conv" });
    const conv = getOrCreateConversation(project.id);
    expect(conv.id).toBeDefined();
    expect(conv.projectId).toBe(project.id);
    expect(conv.channel).toBe("app");
    expect(conv.createdAt).toBeDefined();
  });

  it("returns the same conversation on repeated calls", () => {
    const project = createProject({ name: "Idempotent Project", directoryPath: "/tmp/idem" });
    const first = getOrCreateConversation(project.id);
    const second = getOrCreateConversation(project.id);
    expect(first.id).toBe(second.id);
  });
});

describe("createMessage", () => {
  it("creates a user message", () => {
    const conv = getOrCreateConversation(projectId);
    const msg = createMessage({
      conversationId: conv.id,
      role: "user",
      content: "Hello, AI!",
    });
    expect(msg.id).toBeDefined();
    expect(msg.conversationId).toBe(conv.id);
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("Hello, AI!");
    expect(msg.toolCalls).toBeNull();
    expect(msg.toolResults).toBeNull();
    expect(msg.pendingActions).toBeNull();
  });

  it("creates an assistant message with tool calls and pending actions", () => {
    const conv = getOrCreateConversation(projectId);
    const toolCalls = [{ id: "call-1", tool: "list_goals", args: {} }];
    const pendingActions = [
      {
        callId: "call-1",
        tool: "create_goal",
        args: { name: "Test" },
        description: "Create goal: Test",
        status: "pending" as const,
      },
    ];

    const msg = createMessage({
      conversationId: conv.id,
      role: "assistant",
      content: "I'll create that goal for you.",
      toolCalls,
      pendingActions,
    });

    expect(msg.toolCalls).toEqual(toolCalls);
    expect(msg.pendingActions).toEqual(pendingActions);
  });
});

describe("getMessage", () => {
  it("retrieves a message by ID", () => {
    const conv = getOrCreateConversation(projectId);
    const created = createMessage({ conversationId: conv.id, role: "user", content: "Hi" });
    const fetched = getMessage(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.content).toBe("Hi");
  });

  it("returns null for non-existent ID", () => {
    expect(getMessage("non-existent-id")).toBeNull();
  });
});

describe("updateMessagePendingActions", () => {
  it("updates pending actions on a message", () => {
    const conv = getOrCreateConversation(projectId);
    const msg = createMessage({
      conversationId: conv.id,
      role: "assistant",
      content: "I can do that.",
      pendingActions: [
        { callId: "c1", tool: "create_goal", args: {}, description: "Create", status: "pending" },
      ],
    });

    const updated = updateMessagePendingActions(msg.id, [
      { callId: "c1", tool: "create_goal", args: {}, description: "Create", status: "approved" },
    ]);

    expect(updated.pendingActions![0].status).toBe("approved");
  });

  it("throws for non-existent message ID", () => {
    expect(() =>
      updateMessagePendingActions("non-existent", []),
    ).toThrow("Message not found");
  });
});

describe("listMessagesForProject", () => {
  it("returns empty array for project with no conversation", () => {
    const newProject = createProject({ name: "Empty Project", directoryPath: "/tmp/empty-p" });
    expect(listMessagesForProject(newProject.id)).toEqual([]);
  });

  it("returns all messages for the project conversation", () => {
    const proj = createProject({ name: "Order Project", directoryPath: "/tmp/order" });
    const conv = getOrCreateConversation(proj.id);
    createMessage({ conversationId: conv.id, role: "user", content: "First" });
    createMessage({ conversationId: conv.id, role: "assistant", content: "Second" });
    createMessage({ conversationId: conv.id, role: "user", content: "Third" });

    const msgs = listMessagesForProject(proj.id);
    expect(msgs).toHaveLength(3);
    const contents = msgs.map((m) => m.content);
    expect(contents).toContain("First");
    expect(contents).toContain("Second");
    expect(contents).toContain("Third");
  });

  it("respects the limit parameter", () => {
    const proj = createProject({ name: "Limit Project", directoryPath: "/tmp/limit" });
    const conv = getOrCreateConversation(proj.id);
    for (let i = 0; i < 5; i++) {
      createMessage({ conversationId: conv.id, role: "user", content: `Message ${i}` });
    }
    const limited = listMessagesForProject(proj.id, 3);
    expect(limited).toHaveLength(3);
  });
});

describe("clearConversation", () => {
  it("deletes all messages for the project", () => {
    const proj = createProject({ name: "Clear Project", directoryPath: "/tmp/clear" });
    const conv = getOrCreateConversation(proj.id);
    createMessage({ conversationId: conv.id, role: "user", content: "A message" });
    createMessage({ conversationId: conv.id, role: "assistant", content: "A reply" });

    clearConversation(proj.id);
    expect(listMessagesForProject(proj.id)).toHaveLength(0);
  });

  it("is a no-op for a project with no conversation", () => {
    const proj = createProject({ name: "No Conv Project", directoryPath: "/tmp/noconv" });
    expect(() => clearConversation(proj.id)).not.toThrow();
  });
});

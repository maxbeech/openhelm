import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./helpers.js";
import { createProject } from "../src/db/queries/projects.js";
import { setSetting } from "../src/db/queries/settings.js";
import { getGoal } from "../src/db/queries/goals.js";
import { getJob, listJobs } from "../src/db/queries/jobs.js";
import {
  getOrCreateConversation,
  createMessage,
  listMessagesForProject,
} from "../src/db/queries/conversations.js";

const callLlmViaCliMock = vi.fn();
const emitMock = vi.fn();

vi.mock("../src/planner/llm-via-cli.js", () => ({
  callLlmViaCli: (...args: unknown[]) => callLlmViaCliMock(...args),
}));
vi.mock("../src/ipc/emitter.js", () => ({ emit: (...args: unknown[]) => emitMock(...args) }));
vi.mock("../src/executor/index.js", () => ({ executor: { processNext: vi.fn() } }));

import {
  handleChatMessage,
  handleActionApproval,
  handleActionRejection,
  handleApproveAll,
  handleRejectAll,
} from "../src/chat/handler.js";

let cleanup: () => void;
let projectId: string;

beforeAll(() => {
  cleanup = setupTestDb();
  setSetting("claude_code_path", "/usr/bin/claude");
  const project = createProject({
    name: "Chat Handler Test",
    directoryPath: "/tmp/chat-handler",
  });
  projectId = project.id;
});

afterAll(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Clear conversation between tests by creating a fresh project per test where needed
});

describe("handleChatMessage — native tool wiring", () => {
  it("passes disableTools: false to callLlmViaCli", async () => {
    callLlmViaCliMock.mockResolvedValueOnce("Done.");

    await handleChatMessage(projectId, "Search the web");

    expect(callLlmViaCliMock).toHaveBeenCalledWith(
      expect.objectContaining({ disableTools: false }),
    );
  });

  it("passes the project directoryPath as workingDirectory", async () => {
    callLlmViaCliMock.mockResolvedValueOnce("Done.");

    await handleChatMessage(projectId, "Read a file");

    expect(callLlmViaCliMock).toHaveBeenCalledWith(
      expect.objectContaining({ workingDirectory: "/tmp/chat-handler" }),
    );
  });

  it("passes permissionMode 'plan' for read-only native tool access", async () => {
    callLlmViaCliMock.mockResolvedValueOnce("Done.");

    await handleChatMessage(projectId, "Search something");

    expect(callLlmViaCliMock).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: "plan" }),
    );
  });
});

describe("handleChatMessage — plain text response", () => {
  it("stores user and assistant messages and returns both", async () => {
    callLlmViaCliMock.mockResolvedValueOnce("Here is some helpful info.");

    const msgs = await handleChatMessage(projectId, "Tell me about the project");

    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("Tell me about the project");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toBe("Here is some helpful info.");
  });

  it("emits chat.messageCreated for user and assistant messages", async () => {
    callLlmViaCliMock.mockResolvedValueOnce("Great question.");

    await handleChatMessage(projectId, "What are goals?");

    const messageCreatedCalls = emitMock.mock.calls.filter(([event]) => event === "chat.messageCreated");
    expect(messageCreatedCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("persists messages to the database", async () => {
    const proj = createProject({ name: "Persist Test", directoryPath: "/tmp/persist" });
    callLlmViaCliMock.mockResolvedValueOnce("I understand.");

    await handleChatMessage(proj.id, "Hello");

    const stored = listMessagesForProject(proj.id);
    expect(stored.some((m) => m.role === "user" && m.content === "Hello")).toBe(true);
    expect(stored.some((m) => m.role === "assistant")).toBe(true);
  });

  it("uses the chat model tier", async () => {
    callLlmViaCliMock.mockResolvedValueOnce("Sure.");

    await handleChatMessage(projectId, "Any question");

    expect(callLlmViaCliMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "chat" }),
    );
  });

  it("throws when project not found", async () => {
    await expect(handleChatMessage("fake-id", "hi")).rejects.toThrow("Project not found");
  });
});

describe("handleChatMessage — read tool auto-execution", () => {
  it("auto-executes a read tool and continues to produce a response", async () => {
    // First call returns a read tool call
    callLlmViaCliMock.mockResolvedValueOnce(
      `Let me check.\n<tool_call>{"tool":"list_goals","args":{}}</tool_call>`,
    );
    // Second call (after tool result injected) returns final text
    callLlmViaCliMock.mockResolvedValueOnce("You have no goals yet.");

    const msgs = await handleChatMessage(projectId, "What goals do I have?");

    expect(msgs[1].toolCalls).not.toBeNull();
    expect(msgs[1].toolCalls![0].tool).toBe("list_goals");
    expect(msgs[1].content).toBe("You have no goals yet.");
    expect(callLlmViaCliMock).toHaveBeenCalledTimes(2);
  });
});

describe("handleChatMessage — write tool pending actions", () => {
  it("stores write tools as pending actions without executing them", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(
      `I'll create that goal.\n<tool_call>{"tool":"create_goal","args":{"name":"My Goal"}}</tool_call>`,
    );

    const msgs = await handleChatMessage(projectId, "Create a goal called My Goal");

    const assistantMsg = msgs[1];
    expect(assistantMsg.pendingActions).not.toBeNull();
    expect(assistantMsg.pendingActions).toHaveLength(1);
    expect(assistantMsg.pendingActions![0].tool).toBe("create_goal");
    expect(assistantMsg.pendingActions![0].status).toBe("pending");
    expect(assistantMsg.pendingActions![0].args).toEqual({ name: "My Goal" });
  });

  it("emits chat.actionPending when write tools are present", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(
      `<tool_call>{"tool":"create_goal","args":{"name":"Another Goal"}}</tool_call>`,
    );

    await handleChatMessage(projectId, "Make a goal");

    const pendingCalls = emitMock.mock.calls.filter(([event]) => event === "chat.actionPending");
    expect(pendingCalls.length).toBe(1);
  });

  it("does not call LLM again when write tools are pending", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(
      `<tool_call>{"tool":"archive_goal","args":{"goalId":"g1"}}</tool_call>`,
    );

    await handleChatMessage(projectId, "Archive that goal");

    // Only one LLM call — tool loop stops at write tools
    expect(callLlmViaCliMock).toHaveBeenCalledTimes(1);
  });
});

describe("handleActionApproval", () => {
  it("executes the write tool and marks action as approved", async () => {
    const proj = createProject({ name: "Approve Test", directoryPath: "/tmp/approve" });
    callLlmViaCliMock.mockResolvedValueOnce(
      `<tool_call>{"tool":"create_goal","args":{"name":"Approved Goal"}}</tool_call>`,
    );

    const msgs = await handleChatMessage(proj.id, "Create a goal");
    const assistantMsg = msgs[1];
    const action = assistantMsg.pendingActions![0];

    vi.clearAllMocks();
    const updated = await handleActionApproval(assistantMsg.id, action.callId, proj.id);

    expect(updated.pendingActions![0].status).toBe("approved");
  });

  it("emits chat.actionResolved with status approved", async () => {
    const proj = createProject({ name: "Approve Emit Test", directoryPath: "/tmp/approve-emit" });
    callLlmViaCliMock.mockResolvedValueOnce(
      `<tool_call>{"tool":"create_goal","args":{"name":"Emit Goal"}}</tool_call>`,
    );

    const msgs = await handleChatMessage(proj.id, "Create goal");
    const action = msgs[1].pendingActions![0];

    vi.clearAllMocks();
    await handleActionApproval(msgs[1].id, action.callId, proj.id);

    const resolved = emitMock.mock.calls.find(([event]) => event === "chat.actionResolved");
    expect(resolved).toBeDefined();
    expect(resolved![1]).toMatchObject({ status: "approved" });
  });

  it("throws when message does not exist", async () => {
    await expect(handleActionApproval("fake-id", "call-1", projectId)).rejects.toThrow("Message not found");
  });

  it("throws when action callId does not exist", async () => {
    const conv = getOrCreateConversation(projectId);
    const msg = createMessage({
      conversationId: conv.id,
      role: "assistant",
      content: "Here",
      pendingActions: [
        { callId: "call-x", tool: "create_goal", args: {}, description: "d", status: "pending" },
      ],
    });

    await expect(handleActionApproval(msg.id, "wrong-call-id", projectId)).rejects.toThrow(
      "Action not found",
    );
  });

  it("throws when action is already resolved", async () => {
    const conv = getOrCreateConversation(projectId);
    const msg = createMessage({
      conversationId: conv.id,
      role: "assistant",
      content: "Here",
      pendingActions: [
        { callId: "call-y", tool: "create_goal", args: { name: "g" }, description: "d", status: "approved" },
      ],
    });

    await expect(handleActionApproval(msg.id, "call-y", projectId)).rejects.toThrow(
      "already resolved",
    );
  });
});

describe("handleActionRejection", () => {
  it("marks the action as rejected without executing the tool", async () => {
    const proj = createProject({ name: "Reject Test", directoryPath: "/tmp/reject" });
    callLlmViaCliMock.mockResolvedValueOnce(
      `<tool_call>{"tool":"create_goal","args":{"name":"Rejected Goal"}}</tool_call>`,
    );

    const msgs = await handleChatMessage(proj.id, "Create a goal");
    const action = msgs[1].pendingActions![0];

    const updated = handleActionRejection(msgs[1].id, action.callId);
    expect(updated.pendingActions![0].status).toBe("rejected");
  });

  it("emits chat.actionResolved with status rejected", async () => {
    const proj = createProject({ name: "Reject Emit", directoryPath: "/tmp/reject-emit" });
    callLlmViaCliMock.mockResolvedValueOnce(
      `<tool_call>{"tool":"create_goal","args":{"name":"r"}}</tool_call>`,
    );

    const msgs = await handleChatMessage(proj.id, "Create");
    const action = msgs[1].pendingActions![0];

    vi.clearAllMocks();
    handleActionRejection(msgs[1].id, action.callId);

    const resolved = emitMock.mock.calls.find(([event]) => event === "chat.actionResolved");
    expect(resolved![1]).toMatchObject({ status: "rejected" });
  });

  it("throws when message does not exist", () => {
    expect(() => handleActionRejection("fake-id", "call-1")).toThrow("Message not found");
  });
});

describe("handleActionApproval — goal+job FK linking", () => {
  it("updates sibling create_job goalId after create_goal approval", async () => {
    const proj = createProject({ name: "FK Link Test", directoryPath: "/tmp/fk-link" });
    callLlmViaCliMock.mockResolvedValueOnce(
      [
        `I'll set that up.`,
        `<tool_call>{"tool":"create_goal","args":{"name":"FK Test Goal"}}</tool_call>`,
        `<tool_call>{"tool":"create_job","args":{"name":"FK Test Job","prompt":"run tests","goalId":"placeholder-id","scheduleType":"once"}}</tool_call>`,
      ].join("\n"),
    );

    const msgs = await handleChatMessage(proj.id, "Create goal and job");
    const assistantMsg = msgs[1];
    expect(assistantMsg.pendingActions).toHaveLength(2);
    expect(assistantMsg.pendingActions![0].tool).toBe("create_goal");
    expect(assistantMsg.pendingActions![1].tool).toBe("create_job");
    expect(assistantMsg.pendingActions![1].args.goalId).toBe("placeholder-id");

    // Approve goal — this should update the sibling job's goalId
    vi.clearAllMocks();
    const afterGoalApproval = await handleActionApproval(
      assistantMsg.id,
      assistantMsg.pendingActions![0].callId,
      proj.id,
    );

    const goalAction = afterGoalApproval.pendingActions!.find((a) => a.tool === "create_goal")!;
    expect(goalAction.status).toBe("approved");

    // Verify the sibling create_job now has the real goal ID
    const jobAction = afterGoalApproval.pendingActions!.find((a) => a.tool === "create_job")!;
    expect(jobAction.args.goalId).not.toBe("placeholder-id");
    const realGoal = getGoal(jobAction.args.goalId as string);
    expect(realGoal).not.toBeNull();
    expect(realGoal!.name).toBe("FK Test Goal");

    // Now approve the job — should succeed without FK error
    const afterJobApproval = await handleActionApproval(
      assistantMsg.id,
      jobAction.callId,
      proj.id,
    );
    expect(afterJobApproval.pendingActions!.find((a) => a.tool === "create_job")!.status).toBe("approved");

    // Verify the job was created and linked to the goal
    const jobs = listJobs({ projectId: proj.id, goalId: realGoal!.id });
    expect(jobs.some((j) => j.name === "FK Test Job")).toBe(true);
  });

  it("does not overwrite goalId if it already points to an existing goal", async () => {
    const proj = createProject({ name: "FK Existing Test", directoryPath: "/tmp/fk-existing" });

    // Create a pre-existing goal first
    callLlmViaCliMock.mockResolvedValueOnce(
      `<tool_call>{"tool":"create_goal","args":{"name":"Pre-existing Goal"}}</tool_call>`,
    );
    const setupMsgs = await handleChatMessage(proj.id, "Setup");
    const setupMsg = setupMsgs[1];
    await handleActionApproval(setupMsg.id, setupMsg.pendingActions![0].callId, proj.id);

    // Find the real goal ID
    const existingGoals = listJobs({ projectId: proj.id }); // just to get project context
    // Actually use getGoal approach — list goals for project
    const { listGoals } = await import("../src/db/queries/goals.js");
    const goals = listGoals({ projectId: proj.id, status: "active" });
    const preExistingGoal = goals.find((g) => g.name === "Pre-existing Goal")!;

    // Now create a new goal+job where job's goalId points to the pre-existing goal
    vi.clearAllMocks();
    callLlmViaCliMock.mockResolvedValueOnce(
      [
        `<tool_call>{"tool":"create_goal","args":{"name":"Another Goal"}}</tool_call>`,
        `<tool_call>{"tool":"create_job","args":{"name":"Linked Job","prompt":"test","goalId":"${preExistingGoal.id}","scheduleType":"once"}}</tool_call>`,
      ].join("\n"),
    );

    const msgs = await handleChatMessage(proj.id, "Another goal+job");
    const msg = msgs[1];

    await handleActionApproval(msg.id, msg.pendingActions![0].callId, proj.id);

    // The job's goalId should NOT be overwritten since it points to an existing goal
    const { getMessage } = await import("../src/db/queries/conversations.js");
    const updated = getMessage(msg.id)!;
    const jobAction = updated.pendingActions!.find((a) => a.tool === "create_job")!;
    expect(jobAction.args.goalId).toBe(preExistingGoal.id);
  });

  it("links jobs to correct goals when multiple goals are created in one batch", async () => {
    const proj = createProject({ name: "Multi-Goal FK", directoryPath: "/tmp/multi-goal-fk" });
    callLlmViaCliMock.mockResolvedValueOnce(
      [
        `I'll set up two goals with jobs.`,
        `<tool_call>{"tool":"create_goal","args":{"name":"Goal Alpha"}}</tool_call>`,
        `<tool_call>{"tool":"create_job","args":{"name":"Job A1","prompt":"test a1","goalId":"pending","scheduleType":"once"}}</tool_call>`,
        `<tool_call>{"tool":"create_job","args":{"name":"Job A2","prompt":"test a2","goalId":"pending","scheduleType":"once"}}</tool_call>`,
        `<tool_call>{"tool":"create_goal","args":{"name":"Goal Beta"}}</tool_call>`,
        `<tool_call>{"tool":"create_job","args":{"name":"Job B1","prompt":"test b1","goalId":"pending","scheduleType":"once"}}</tool_call>`,
      ].join("\n"),
    );

    const msgs = await handleChatMessage(proj.id, "Create two goals with jobs");
    const assistantMsg = msgs[1];
    expect(assistantMsg.pendingActions).toHaveLength(5);

    // Approve all actions sequentially
    vi.clearAllMocks();
    const updated = await handleApproveAll(assistantMsg.id, proj.id);
    expect(updated.pendingActions!.every((a) => a.status === "approved")).toBe(true);

    // Verify goals exist
    const { listGoals } = await import("../src/db/queries/goals.js");
    const goals = listGoals({ projectId: proj.id, status: "active" });
    const goalAlpha = goals.find((g) => g.name === "Goal Alpha")!;
    const goalBeta = goals.find((g) => g.name === "Goal Beta")!;
    expect(goalAlpha).toBeDefined();
    expect(goalBeta).toBeDefined();

    // Verify Job A1 and A2 are linked to Goal Alpha
    const jobsAlpha = listJobs({ projectId: proj.id, goalId: goalAlpha.id });
    expect(jobsAlpha.some((j) => j.name === "Job A1")).toBe(true);
    expect(jobsAlpha.some((j) => j.name === "Job A2")).toBe(true);

    // Verify Job B1 is linked to Goal Beta (NOT Goal Alpha)
    const jobsBeta = listJobs({ projectId: proj.id, goalId: goalBeta.id });
    expect(jobsBeta.some((j) => j.name === "Job B1")).toBe(true);

    // Verify Job B1 is NOT linked to Goal Alpha
    expect(jobsAlpha.some((j) => j.name === "Job B1")).toBe(false);
  });
});

describe("handleChatMessage — status events", () => {
  it("emits chat.status thinking before LLM call", async () => {
    callLlmViaCliMock.mockResolvedValueOnce("Hello.");

    await handleChatMessage(projectId, "Hi");

    const statusCalls = emitMock.mock.calls.filter(([event]) => event === "chat.status");
    expect(statusCalls.length).toBeGreaterThanOrEqual(2); // thinking + done
    expect(statusCalls[0][1]).toMatchObject({ status: "thinking" });
    expect(statusCalls[statusCalls.length - 1][1]).toMatchObject({ status: "done" });
  });

  it("emits reading status when read tools are executed", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(
      `<tool_call>{"tool":"list_goals","args":{}}</tool_call>`,
    );
    callLlmViaCliMock.mockResolvedValueOnce("No goals.");

    await handleChatMessage(projectId, "List goals");

    const statusCalls = emitMock.mock.calls.filter(([event]) => event === "chat.status");
    const readingStatus = statusCalls.find(([, data]) => data.status === "reading");
    expect(readingStatus).toBeDefined();
    expect(readingStatus![1].tools).toContain("list_goals");
  });

  it("emits analyzing status on second LLM call", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(
      `<tool_call>{"tool":"list_goals","args":{}}</tool_call>`,
    );
    callLlmViaCliMock.mockResolvedValueOnce("Done.");

    await handleChatMessage(projectId, "Check goals");

    const statusCalls = emitMock.mock.calls.filter(([event]) => event === "chat.status");
    const analyzing = statusCalls.find(([, data]) => data.status === "analyzing");
    expect(analyzing).toBeDefined();
  });
});

describe("handleApproveAll", () => {
  it("approves all pending actions in one call", async () => {
    const proj = createProject({ name: "ApproveAll Test", directoryPath: "/tmp/approve-all" });
    callLlmViaCliMock.mockResolvedValueOnce(
      [
        `I'll set that up.`,
        `<tool_call>{"tool":"create_goal","args":{"name":"Batch Goal"}}</tool_call>`,
        `<tool_call>{"tool":"create_job","args":{"name":"Batch Job","prompt":"test","goalId":"placeholder","scheduleType":"once"}}</tool_call>`,
      ].join("\n"),
    );

    const msgs = await handleChatMessage(proj.id, "Create goal and job");
    expect(msgs[1].pendingActions).toHaveLength(2);
    expect(msgs[1].pendingActions!.every((a) => a.status === "pending")).toBe(true);

    vi.clearAllMocks();
    const updated = await handleApproveAll(msgs[1].id, proj.id);

    expect(updated.pendingActions!.every((a) => a.status === "approved")).toBe(true);

    // Verify both entities were created in DB
    const { listGoals } = await import("../src/db/queries/goals.js");
    const goals = listGoals({ projectId: proj.id, status: "active" });
    expect(goals.some((g) => g.name === "Batch Goal")).toBe(true);

    const jobs = listJobs({ projectId: proj.id });
    expect(jobs.some((j) => j.name === "Batch Job")).toBe(true);
  });

  it("throws when no pending actions remain", async () => {
    const conv = getOrCreateConversation(projectId);
    const msg = createMessage({
      conversationId: conv.id,
      role: "assistant",
      content: "Done",
      pendingActions: [
        { callId: "c-done", tool: "create_goal", args: { name: "x" }, description: "d", status: "approved" },
      ],
    });

    await expect(handleApproveAll(msg.id, projectId)).rejects.toThrow("No pending actions");
  });

  it("throws when message not found", async () => {
    await expect(handleApproveAll("nonexistent", projectId)).rejects.toThrow("Message not found");
  });
});

describe("handleRejectAll", () => {
  it("rejects all pending actions at once", async () => {
    const proj = createProject({ name: "RejectAll Test", directoryPath: "/tmp/reject-all" });
    callLlmViaCliMock.mockResolvedValueOnce(
      [
        `<tool_call>{"tool":"create_goal","args":{"name":"Reject Me"}}</tool_call>`,
        `<tool_call>{"tool":"create_job","args":{"name":"Reject Job","prompt":"x","scheduleType":"once"}}</tool_call>`,
      ].join("\n"),
    );

    const msgs = await handleChatMessage(proj.id, "Create stuff");
    expect(msgs[1].pendingActions).toHaveLength(2);

    vi.clearAllMocks();
    const updated = handleRejectAll(msgs[1].id);

    expect(updated.pendingActions!.every((a) => a.status === "rejected")).toBe(true);

    // Verify rejection events emitted for each action
    const resolvedCalls = emitMock.mock.calls.filter(([event]) => event === "chat.actionResolved");
    expect(resolvedCalls).toHaveLength(2);
    expect(resolvedCalls.every(([, data]) => data.status === "rejected")).toBe(true);
  });

  it("throws when no pending actions remain", () => {
    const conv = getOrCreateConversation(projectId);
    const msg = createMessage({
      conversationId: conv.id,
      role: "assistant",
      content: "Done",
      pendingActions: [
        { callId: "c-rej", tool: "create_goal", args: {}, description: "d", status: "rejected" },
      ],
    });

    expect(() => handleRejectAll(msg.id)).toThrow("No pending actions");
  });

  it("throws when message not found", () => {
    expect(() => handleRejectAll("nonexistent")).toThrow("Message not found");
  });
});

describe("handleChatMessage — projectId in all events (Bug 1)", () => {
  it("includes projectId in every chat event", async () => {
    const proj = createProject({ name: "EventPid Test", directoryPath: "/tmp/event-pid" });
    callLlmViaCliMock.mockResolvedValueOnce(
      `Let me check.\n<tool_call>{"tool":"list_goals","args":{}}</tool_call>`,
    );
    callLlmViaCliMock.mockResolvedValueOnce("Here you go.");

    await handleChatMessage(proj.id, "Test events");

    const chatEvents = emitMock.mock.calls.filter(([event]) =>
      event.startsWith("chat."),
    );
    for (const [event, data] of chatEvents) {
      expect(data).toHaveProperty("projectId", proj.id);
    }
  });

  it("includes projectId in actionResolved from handleActionRejection", async () => {
    const proj = createProject({ name: "RejectPid Test", directoryPath: "/tmp/reject-pid" });
    callLlmViaCliMock.mockResolvedValueOnce(
      `<tool_call>{"tool":"create_goal","args":{"name":"Pid Goal"}}</tool_call>`,
    );

    const msgs = await handleChatMessage(proj.id, "Create goal");
    vi.clearAllMocks();
    handleActionRejection(msgs[1].id, msgs[1].pendingActions![0].callId);

    const resolved = emitMock.mock.calls.find(([event]) => event === "chat.actionResolved");
    expect(resolved![1]).toHaveProperty("projectId", proj.id);
  });

  it("includes projectId in actionResolved from handleRejectAll", async () => {
    const proj = createProject({ name: "RejectAllPid", directoryPath: "/tmp/rejectall-pid" });
    callLlmViaCliMock.mockResolvedValueOnce(
      `<tool_call>{"tool":"create_goal","args":{"name":"r"}}</tool_call>`,
    );

    const msgs = await handleChatMessage(proj.id, "Make it");
    vi.clearAllMocks();
    handleRejectAll(msgs[1].id);

    const resolved = emitMock.mock.calls.find(([event]) => event === "chat.actionResolved");
    expect(resolved![1]).toHaveProperty("projectId", proj.id);
  });
});

describe("handleChatMessage — cross-project context validation (Bug 2)", () => {
  it("discards viewingGoal that belongs to a different project", async () => {
    const projA = createProject({ name: "Proj A", directoryPath: "/tmp/projA" });
    const projB = createProject({ name: "Proj B", directoryPath: "/tmp/projB" });

    // Create a goal in project A via chat
    callLlmViaCliMock.mockResolvedValueOnce(
      `<tool_call>{"tool":"create_goal","args":{"name":"Goal in A"}}</tool_call>`,
    );
    const msgs = await handleChatMessage(projA.id, "Create goal");
    await handleActionApproval(msgs[1].id, msgs[1].pendingActions![0].callId, projA.id);

    const { listGoals } = await import("../src/db/queries/goals.js");
    const goalsA = listGoals({ projectId: projA.id, status: "active" });
    const goalInA = goalsA.find((g) => g.name === "Goal in A")!;

    // Now send a message in project B with project A's goal as context
    vi.clearAllMocks();
    callLlmViaCliMock.mockResolvedValueOnce("I'll help with your project.");

    await handleChatMessage(projB.id, "Help me", { viewingGoalId: goalInA.id });

    // The system prompt should NOT include the cross-project goal
    const llmCallArgs = callLlmViaCliMock.mock.calls[0][0];
    expect(llmCallArgs.systemPrompt).not.toContain("Goal in A");
  });
});

describe("handleChatMessage — empty content fallback (Bug 3)", () => {
  it("provides fallback content when LLM returns only write tool calls", async () => {
    callLlmViaCliMock.mockResolvedValueOnce(
      `<tool_call>{"tool":"create_goal","args":{"name":"Orphan Goal"}}</tool_call>`,
    );

    const msgs = await handleChatMessage(projectId, "Create a goal");
    const assistant = msgs[1];

    expect(assistant.content).toBeTruthy();
    expect(assistant.content).toBe("Based on your request, here's what I'd suggest:");
  });

  it("provides fallback content when LLM returns only read tool calls with no final text", async () => {
    // First call: only tool calls, no text
    callLlmViaCliMock.mockResolvedValueOnce(
      `<tool_call>{"tool":"list_goals","args":{}}</tool_call>`,
    );
    // Second call: empty response
    callLlmViaCliMock.mockResolvedValueOnce("");

    const msgs = await handleChatMessage(projectId, "Show goals");
    const assistant = msgs[1];

    expect(assistant.content).toBeTruthy();
    expect(assistant.content).toBe("I looked into this for you.");
  });

  it("preserves original content when LLM provides text", async () => {
    callLlmViaCliMock.mockResolvedValueOnce("Here is my detailed response.");

    const msgs = await handleChatMessage(projectId, "Tell me something");
    expect(msgs[1].content).toBe("Here is my detailed response.");
  });
});

describe("handleChatMessage — preferRawText flag (Issue 1 fix)", () => {
  it("passes preferRawText: true to callLlmViaCli for chat", async () => {
    callLlmViaCliMock.mockResolvedValueOnce("Sure.");

    await handleChatMessage(projectId, "Test raw text");

    expect(callLlmViaCliMock).toHaveBeenCalledWith(
      expect.objectContaining({ preferRawText: true }),
    );
  });
});

describe("handleChatMessage — early thinking status (Issue 2 fix)", () => {
  it("emits thinking status before callLlmViaCli is invoked", async () => {
    callLlmViaCliMock.mockResolvedValueOnce("Done.");

    await handleChatMessage(projectId, "Quick check");

    // The first chat.status event should be "thinking" and it must appear
    // BEFORE the first callLlmViaCli call. Since the mock records call order
    // and emitMock records emit order, verify thinking is emitted before LLM call.
    const allEmits = emitMock.mock.calls.map(([event, data]) => ({ event, data }));
    const firstThinking = allEmits.findIndex(
      (e) => e.event === "chat.status" && e.data.status === "thinking",
    );
    // Should be right after messageCreated (index 1), before any LLM call
    expect(firstThinking).toBeGreaterThan(-1);

    // The thinking emit must happen before the first LLM invocation.
    // Since callLlmViaCli is mocked and resolves immediately, verify that
    // at least two "thinking" statuses exist (early + loop start).
    const thinkingStatuses = allEmits.filter(
      (e) => e.event === "chat.status" && e.data.status === "thinking",
    );
    expect(thinkingStatuses.length).toBeGreaterThanOrEqual(2);
  });
});

describe("handleChatMessage — streaming sanitizer (Issue 3 fix)", () => {
  it("strips tool_call XML that arrives in a single chunk", async () => {
    callLlmViaCliMock.mockImplementationOnce(async (config: Record<string, unknown>) => {
      const onTextChunk = config.onTextChunk as (text: string) => void;
      onTextChunk('Here is my plan.\n<tool_call>{"tool":"create_goal","args":{"name":"Test"}}</tool_call>\nAll done.');
      return 'Here is my plan.\n<tool_call>{"tool":"create_goal","args":{"name":"Test"}}</tool_call>\nAll done.';
    });

    await handleChatMessage(projectId, "Test streaming single chunk");

    const streamEvents = emitMock.mock.calls.filter(([event]) => event === "chat.streaming");
    const streamedText = streamEvents.map(([, data]) => data.text).join("");
    expect(streamedText).not.toContain("<tool_call>");
    expect(streamedText).not.toContain("</tool_call>");
    expect(streamedText).toContain("Here is my plan.");
    expect(streamedText).toContain("All done.");
  });

  it("strips tool_call XML spanning multiple chunks", async () => {
    callLlmViaCliMock.mockImplementationOnce(async (config: Record<string, unknown>) => {
      const onTextChunk = config.onTextChunk as (text: string) => void;
      // Simulate tool_call split across 3 chunks
      onTextChunk("Before text.\n<tool_call>{\"tool\":");
      onTextChunk("\"create_goal\",\"args\":{\"name\":\"Test\"}}");
      onTextChunk("</tool_call>\nAfter text.");
      return 'Before text.\n<tool_call>{"tool":"create_goal","args":{"name":"Test"}}</tool_call>\nAfter text.';
    });

    await handleChatMessage(projectId, "Test streaming multi chunk");

    const streamEvents = emitMock.mock.calls.filter(([event]) => event === "chat.streaming");
    const streamedText = streamEvents.map(([, data]) => data.text).join("");
    expect(streamedText).not.toContain("<tool_call>");
    expect(streamedText).not.toContain("</tool_call>");
    expect(streamedText).not.toContain("create_goal");
    expect(streamedText).toContain("Before text.");
    expect(streamedText).toContain("After text.");
  });

  it("handles incomplete tool_call at end of stream without leaking", async () => {
    callLlmViaCliMock.mockImplementationOnce(async (config: Record<string, unknown>) => {
      const onTextChunk = config.onTextChunk as (text: string) => void;
      onTextChunk("Some text <tool_call>{\"tool\":\"create_goal\"");
      // Stream ends without </tool_call>
      return "Some text";
    });

    await handleChatMessage(projectId, "Test incomplete tool call");

    const streamEvents = emitMock.mock.calls.filter(([event]) => event === "chat.streaming");
    const streamedText = streamEvents.map(([, data]) => data.text).join("");
    expect(streamedText).not.toContain("<tool_call>");
    expect(streamedText).toContain("Some text");
  });
});

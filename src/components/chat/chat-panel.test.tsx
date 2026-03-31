import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatPanel } from "./chat-panel";
import { useChatStore } from "@/stores/chat-store";
import { useAppStore } from "@/stores/app-store";
import type { ChatMessage } from "@openhelm/shared";

// jsdom doesn't implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock("@/lib/api", () => ({
  listChatMessages: vi.fn().mockResolvedValue([]),
  sendChatMessage: vi.fn().mockResolvedValue(undefined),
  approveChatAction: vi.fn(),
  rejectChatAction: vi.fn(),
  approveAllChatActions: vi.fn(),
  rejectAllChatActions: vi.fn(),
  clearChat: vi.fn().mockResolvedValue(undefined),
  listConversations: vi.fn().mockResolvedValue([]),
  createConversation: vi.fn(),
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
  reorderConversations: vi.fn(),
}));

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    conversationId: "c1",
    role: "user",
    content: "Hello there",
    toolCalls: null,
    toolResults: null,
    pendingActions: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  useChatStore.setState({
    messages: [],
    panelOpen: true,
    error: null,
    loading: false,
    conversations: [],
    activeConversationId: null,
    activeConversationIds: {},
    conversationStates: {},
  });
  useAppStore.setState({
    contentView: "home",
    selectedGoalId: null,
    selectedJobId: null,
    selectedRunId: null,
  } as any);
  vi.clearAllMocks();
});

describe("ChatPanel", () => {
  it("renders nothing when panel is closed", () => {
    useChatStore.setState({ panelOpen: false });
    const { container } = render(<ChatPanel projectId="p1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the Chat header when open", () => {
    render(<ChatPanel projectId="p1" />);
    expect(screen.getByText("Chat")).toBeInTheDocument();
  });

  it("shows the empty state when no messages", () => {
    render(<ChatPanel projectId="p1" />);
    expect(screen.getByText("Chat with your AI assistant")).toBeInTheDocument();
  });

  it("renders user and assistant messages", () => {
    useChatStore.setState({
      messages: [
        makeMessage({ role: "user", content: "What are goals?" }),
        makeMessage({ id: "m2", role: "assistant", content: "Goals are objectives you set." }),
      ],
    });
    render(<ChatPanel projectId="p1" />);
    expect(screen.getByText("What are goals?")).toBeInTheDocument();
    expect(screen.getByText("Goals are objectives you set.")).toBeInTheDocument();
  });

  it("does not show clear button in header (moved to thread dropdown)", () => {
    useChatStore.setState({ messages: [makeMessage()] });
    render(<ChatPanel projectId="p1" />);
    expect(screen.queryByTitle("Clear chat history")).not.toBeInTheDocument();
  });

  it("calls closePanel when close button is clicked", () => {
    render(<ChatPanel projectId="p1" />);
    // Find button that is NOT the Send button (not the chat input's send)
    // The close button has no title and is in the header. Without messages,
    // only the close button and the send button exist. Close button is first in DOM order.
    const allButtons = screen.getAllByRole("button");
    // First button in header area (no title attribute) is the close button
    const closeBtn = allButtons.find((b) => !b.getAttribute("title"));
    expect(closeBtn).toBeDefined();
    fireEvent.click(closeBtn!);
    expect(useChatStore.getState().panelOpen).toBe(false);
  });

  it("renders action cards with batch approval buttons for pending actions", () => {
    useChatStore.setState({
      messages: [
        makeMessage({
          id: "m-action",
          role: "assistant",
          content: "I can create that goal.",
          pendingActions: [
            {
              callId: "c1",
              tool: "create_goal",
              args: { name: "New Goal" },
              description: "Create goal: \"New Goal\"",
              status: "pending",
            },
          ],
        }),
      ],
    });
    render(<ChatPanel projectId="p1" />);
    expect(screen.getByText('Create goal: "New Goal"')).toBeInTheDocument();
    expect(screen.getByText("Approve All (1)")).toBeInTheDocument();
    expect(screen.getByText("Request Change")).toBeInTheDocument();
  });

  it("renders Thinking... spinner while sending", () => {
    useChatStore.setState({
      activeConversationId: "conv-1",
      conversationStates: { "conv-1": { sending: true, statusText: null, streamingText: "" } },
    });
    render(<ChatPanel projectId="p1" />);
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("displays error banner when chat store has an error", () => {
    useChatStore.setState({ error: "Claude Code is not logged in." });
    render(<ChatPanel projectId="p1" />);
    expect(screen.getByText("Claude Code is not logged in.")).toBeInTheDocument();
  });

  it("clears error when dismiss button is clicked", () => {
    useChatStore.setState({ error: "Something went wrong" });
    render(<ChatPanel projectId="p1" />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    // Find and click the dismiss button (the X inside the error banner)
    const errorBanner = screen.getByText("Something went wrong").closest("div")!;
    const dismissBtn = errorBanner.querySelector("button:last-child")!;
    fireEvent.click(dismissBtn);

    expect(useChatStore.getState().error).toBeNull();
  });

  it("does not show error banner when there is no error", () => {
    useChatStore.setState({ error: null });
    render(<ChatPanel projectId="p1" />);
    // AlertTriangle icon is only present when there's an error
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });
});

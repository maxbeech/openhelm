import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatPanel } from "./chat-panel";
import { useChatStore } from "@/stores/chat-store";
import { useAppStore } from "@/stores/app-store";
import type { ChatMessage } from "@openorchestra/shared";

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
  useChatStore.setState({ messages: [], sending: false, panelOpen: true, error: null, loading: false });
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

  it("renders the AI Assistant header when open", () => {
    render(<ChatPanel projectId="p1" />);
    expect(screen.getByText("AI Assistant")).toBeInTheDocument();
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

  it("does not show clear button when no messages", () => {
    render(<ChatPanel projectId="p1" />);
    expect(screen.queryByTitle("Clear chat history")).not.toBeInTheDocument();
  });

  it("shows clear button when messages exist", () => {
    useChatStore.setState({ messages: [makeMessage()] });
    render(<ChatPanel projectId="p1" />);
    expect(screen.getByTitle("Clear chat history")).toBeInTheDocument();
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
    useChatStore.setState({ sending: true });
    render(<ChatPanel projectId="p1" />);
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });
});

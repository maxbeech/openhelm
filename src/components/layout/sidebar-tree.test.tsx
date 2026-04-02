import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SidebarTree } from "./sidebar-tree";
import { useAppStore } from "@/stores/app-store";
import { useGoalStore } from "@/stores/goal-store";
import { useJobStore } from "@/stores/job-store";
import { useRunStore } from "@/stores/run-store";

vi.mock("@/lib/api", () => ({
  getJobTokenStats: vi.fn().mockResolvedValue([]),
}));

const mockGoals = [
  {
    id: "g1",
    projectId: "p1",
    parentId: null,
    name: "Improve test coverage",
    description: "Improve test coverage",
    icon: null,
    status: "active" as const,
    sortOrder: 0,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  },
  {
    id: "g2",
    projectId: "p1",
    parentId: null,
    name: "Fix TypeScript errors",
    description: "Fix TypeScript errors",
    icon: null,
    status: "active" as const,
    sortOrder: 1,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  },
];

const mockJobs = [
  {
    id: "j1",
    goalId: "g1",
    projectId: "p1",
    name: "Run tests",
    description: null,
    icon: null,
    prompt: "test",
    scheduleType: "once" as const,
    scheduleConfig: { fireAt: "2026-01-01" },
    isEnabled: true,
    isArchived: false,
    workingDirectory: null,
    nextFireAt: null,
    correctionNote: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  },
  {
    id: "j2",
    goalId: null,
    projectId: "p1",
    name: "Standalone job",
    description: null,
    icon: null,
    prompt: "do something",
    scheduleType: "once" as const,
    scheduleConfig: { fireAt: "2026-01-01" },
    isEnabled: true,
    isArchived: false,
    workingDirectory: null,
    nextFireAt: null,
    correctionNote: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  },
];

const mockCreateGoal = vi.fn().mockResolvedValue({ id: "g-new", name: "New goal", projectId: "p1" });

describe("SidebarTree", () => {
  const onNewJobForGoal = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      contentView: "home",
      selectedGoalId: null,
      selectedJobId: null,
      selectedRunId: null,
      collapsedGoalIds: [],
    });
    useGoalStore.setState({ goals: mockGoals, createGoal: mockCreateGoal } as any);
    useJobStore.setState({ jobs: mockJobs });
    useRunStore.setState({ runs: [] });
  });

  it("renders goals and jobs in tree", () => {
    render(<SidebarTree projectId="p1" onNewJobForGoal={onNewJobForGoal} />);
    expect(screen.getByText("Improve test coverage")).toBeDefined();
    expect(screen.getByText("Fix TypeScript errors")).toBeDefined();
    expect(screen.getByText("Run tests")).toBeDefined();
    expect(screen.getByText("Standalone job")).toBeDefined();
  });

  it("renders Goals header with + button", () => {
    render(<SidebarTree projectId="p1" onNewJobForGoal={onNewJobForGoal} />);
    expect(screen.getByText("Goals")).toBeDefined();
    expect(screen.getByTitle("New goal")).toBeDefined();
  });

  it("shows inline goal input when + is clicked", () => {
    render(<SidebarTree projectId="p1" onNewJobForGoal={onNewJobForGoal} />);
    fireEvent.click(screen.getByTitle("New goal"));
    expect(screen.getByPlaceholderText("Goal name...")).toBeDefined();
  });

  it("creates goal on Enter and closes input", async () => {
    render(<SidebarTree projectId="p1" onNewJobForGoal={onNewJobForGoal} />);
    fireEvent.click(screen.getByTitle("New goal"));
    const input = screen.getByPlaceholderText("Goal name...");
    fireEvent.change(input, { target: { value: "New goal" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("Goal name...")).toBeNull(),
    );
    expect(mockCreateGoal).toHaveBeenCalledWith({ projectId: "p1", name: "New goal" });
  });

  it("dismisses goal input on Escape without creating", async () => {
    render(<SidebarTree projectId="p1" onNewJobForGoal={onNewJobForGoal} />);
    fireEvent.click(screen.getByTitle("New goal"));
    const input = screen.getByPlaceholderText("Goal name...");
    fireEvent.change(input, { target: { value: "Draft" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("Goal name...")).toBeNull(),
    );
    expect(mockCreateGoal).not.toHaveBeenCalled();
  });

  it("selects a goal on click", () => {
    render(<SidebarTree projectId="p1" onNewJobForGoal={onNewJobForGoal} />);
    fireEvent.click(screen.getByText("Improve test coverage"));
    const s = useAppStore.getState();
    expect(s.contentView).toBe("goal-detail");
    expect(s.selectedGoalId).toBe("g1");
  });

  it("selects a job on click", () => {
    render(<SidebarTree projectId="p1" onNewJobForGoal={onNewJobForGoal} />);
    fireEvent.click(screen.getByText("Run tests"));
    const s = useAppStore.getState();
    expect(s.contentView).toBe("job-detail");
    expect(s.selectedJobId).toBe("j1");
  });

  it("renders add menu trigger for each goal", () => {
    render(<SidebarTree projectId="p1" onNewJobForGoal={onNewJobForGoal} />);
    // Each goal should have the dropdown trigger
    const triggers = screen.getAllByTitle("Add sub-goal or job");
    expect(triggers.length).toBe(2); // g1 and g2
  });

  it("collapses goal to hide nested jobs", async () => {
    render(<SidebarTree projectId="p1" onNewJobForGoal={onNewJobForGoal} />);
    expect(screen.getByText("Run tests")).toBeDefined();

    const chevronButtons = screen
      .getAllByRole("button")
      .filter((btn) => btn.tagName === "BUTTON" && btn.querySelector(".lucide-chevron-right"));
    fireEvent.click(chevronButtons[0]);

    // AnimatePresence exit animation keeps the element briefly; wait for removal
    await waitFor(() => {
      expect(screen.queryByText("Run tests")).toBeNull();
    });
  });

  it("shows standalone jobs section", () => {
    render(<SidebarTree projectId="p1" onNewJobForGoal={onNewJobForGoal} />);
    expect(screen.getByText("Jobs")).toBeDefined();
    expect(screen.getByText("Standalone job")).toBeDefined();
  });
});

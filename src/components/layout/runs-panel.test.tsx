import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunsPanel } from "./runs-panel";
import { useAppStore } from "@/stores/app-store";
import { useRunStore } from "@/stores/run-store";
import { useJobStore } from "@/stores/job-store";
import type { Run, Job } from "@openorchestra/shared";

const mockJobs: Job[] = [
  {
    id: "j1",
    goalId: "g1",
    projectId: "p1",
    name: "Test job",
    description: null,
    prompt: "test",
    scheduleType: "once",
    scheduleConfig: { fireAt: "2026-01-01" },
    isEnabled: true,
    isArchived: false,
    workingDirectory: null,
    nextFireAt: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  },
  {
    id: "j2",
    goalId: "g2",
    projectId: "p1",
    name: "Other job",
    description: null,
    prompt: "other",
    scheduleType: "once",
    scheduleConfig: { fireAt: "2026-01-01" },
    isEnabled: true,
    isArchived: false,
    workingDirectory: null,
    nextFireAt: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  },
];

const mockRuns: Run[] = [
  {
    id: "r1",
    jobId: "j1",
    status: "succeeded",
    triggerSource: "manual",
    startedAt: "2026-01-01T10:00:00Z",
    finishedAt: "2026-01-01T10:05:00Z",
    exitCode: 0,
    summary: "Done",
    createdAt: "2026-01-01T10:00:00Z",
  },
  {
    id: "r2",
    jobId: "j2",
    status: "running",
    triggerSource: "scheduled",
    startedAt: "2026-01-01T11:00:00Z",
    finishedAt: null,
    exitCode: null,
    summary: null,
    createdAt: "2026-01-01T11:00:00Z",
  },
];

describe("RunsPanel", () => {
  beforeEach(() => {
    useAppStore.setState({
      runsPanelOpen: true,
      selectedGoalId: null,
      selectedJobId: null,
      selectedRunId: null,
    });
    useRunStore.setState({ runs: mockRuns });
    useJobStore.setState({ jobs: mockJobs });
  });

  it("renders when panel is open", () => {
    render(<RunsPanel />);
    expect(screen.getByText("Runs")).toBeDefined();
  });

  it("does not render when panel is closed", () => {
    useAppStore.setState({ runsPanelOpen: false });
    const { container } = render(<RunsPanel />);
    expect(container.innerHTML).toBe("");
  });

  it("shows all runs by default", () => {
    render(<RunsPanel />);
    expect(screen.getByText("Test job")).toBeDefined();
    expect(screen.getByText("Other job")).toBeDefined();
  });

  it("filters runs by selected job", () => {
    useAppStore.setState({ selectedJobId: "j1" });
    render(<RunsPanel />);
    expect(screen.getByText("Test job")).toBeDefined();
    expect(screen.queryByText("Other job")).toBeNull();
  });

  it("filters runs by selected goal", () => {
    useAppStore.setState({ selectedGoalId: "g1" });
    render(<RunsPanel />);
    expect(screen.getByText("Test job")).toBeDefined();
    expect(screen.queryByText("Other job")).toBeNull();
  });

  it("selects a run on click", () => {
    render(<RunsPanel />);
    fireEvent.click(screen.getByText("Test job"));
    expect(useAppStore.getState().selectedRunId).toBe("r1");
  });

  it("shows empty state when no runs", () => {
    useRunStore.setState({ runs: [] });
    render(<RunsPanel />);
    expect(screen.getByText("No runs yet")).toBeDefined();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { JobEditSheet } from "./job-edit-sheet";
import { useJobStore } from "@/stores/job-store";
import { useGoalStore } from "@/stores/goal-store";
import type { Job } from "@openorchestra/shared";

const mockUpdateJob = vi.fn();

vi.mock("@/lib/api", () => ({
  updateJob: vi.fn().mockResolvedValue({}),
  listJobs: vi.fn().mockResolvedValue([]),
}));

const mockJob: Job = {
  id: "j1",
  goalId: null,
  projectId: "p1",
  name: "Run tests",
  description: null,
  icon: null,
  prompt: "Run the full test suite and fix any failures",
  scheduleType: "interval",
  scheduleConfig: { amount: 2, unit: "hours" },
  isEnabled: true,
  isArchived: false,
  workingDirectory: null,
  nextFireAt: null,
  model: "sonnet",
  modelEffort: "medium",
  permissionMode: "bypassPermissions",
  correctionNote: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const defaultProps = {
  job: mockJob,
  open: true,
  onOpenChange: vi.fn(),
  projectDirectory: "/tmp/my-project",
  onComplete: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  useJobStore.setState({
    jobs: [mockJob],
    loading: false,
    error: null,
    updateJob: mockUpdateJob.mockResolvedValue(mockJob),
    toggleEnabled: vi.fn(),
    archiveJob: vi.fn(),
    deleteJob: vi.fn(),
    createJob: vi.fn(),
    fetchJobs: vi.fn(),
    updateJobInStore: vi.fn(),
  });
  useGoalStore.setState({ goals: [], loading: false, error: null });
});

describe("JobEditSheet", () => {
  it("renders with job fields pre-filled", () => {
    render(<JobEditSheet {...defaultProps} />);
    expect(screen.getByText("Edit Job")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Run tests")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Run the full test suite and fix any failures")
    ).toBeInTheDocument();
  });

  it("shows character count for prompt", () => {
    render(<JobEditSheet {...defaultProps} />);
    const charCount = screen.getByText(
      `${mockJob.prompt.length} chars`
    );
    expect(charCount).toBeInTheDocument();
  });

  it("Save Changes button is enabled when required fields are filled", () => {
    render(<JobEditSheet {...defaultProps} />);
    const saveBtn = screen.getByRole("button", { name: /save changes/i });
    expect(saveBtn).not.toBeDisabled();
  });

  it("disables Save Changes button when name is cleared", () => {
    render(<JobEditSheet {...defaultProps} />);
    const nameInput = screen.getByLabelText(/Name/);
    fireEvent.change(nameInput, { target: { value: "" } });
    const saveBtn = screen.getByRole("button", { name: /save changes/i });
    expect(saveBtn).toBeDisabled();
  });

  it("calls updateJob with updated values on submit", async () => {
    render(<JobEditSheet {...defaultProps} />);
    const nameInput = screen.getByLabelText(/Name/);
    fireEvent.change(nameInput, { target: { value: "Updated job name" } });
    const saveBtn = screen.getByRole("button", { name: /save changes/i });
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(mockUpdateJob).toHaveBeenCalledWith(
        expect.objectContaining({ id: "j1", name: "Updated job name" })
      );
    });
  });

  it("shows project directory as placeholder for working directory", () => {
    render(<JobEditSheet {...defaultProps} />);
    const workdirInput = screen.getByLabelText(/Working directory/);
    expect(workdirInput).toHaveAttribute("placeholder", "/tmp/my-project");
  });

  it("shows Model and Effort selectors", () => {
    render(<JobEditSheet {...defaultProps} />);
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("Effort")).toBeInTheDocument();
  });
});

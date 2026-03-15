import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SidebarJobNode } from "./sidebar-job-node";
import type { Job, Run } from "@openorchestra/shared";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    goalId: null,
    projectId: "proj-1",
    name: "Test Job",
    description: null,
    prompt: "do something",
    scheduleType: "manual",
    scheduleConfig: {},
    isEnabled: true,
    isArchived: false,
    workingDirectory: null,
    nextFireAt: null,
    model: "sonnet",
    modelEffort: "medium",
    permissionMode: "default",
    icon: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: `run-${Math.random().toString(36).slice(2, 8)}`,
    jobId: "job-1",
    status: "succeeded",
    triggerSource: "scheduled",
    scheduledFor: null,
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:01:00Z",
    exitCode: 0,
    summary: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("SidebarJobNode", () => {
  it("renders job name and model badge", () => {
    render(
      <SidebarJobNode
        job={makeJob({ name: "My Job", model: "opus" })}
        recentRuns={[]}
        isSelected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("My Job")).toBeInTheDocument();
    expect(screen.getByText("opus")).toBeInTheDocument();
  });

  it("shows default model when model is empty", () => {
    render(
      <SidebarJobNode
        job={makeJob({ model: "" })}
        recentRuns={[]}
        isSelected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("sonnet")).toBeInTheDocument();
  });

  it("displays schedule label for calendar daily", () => {
    render(
      <SidebarJobNode
        job={makeJob({
          scheduleType: "calendar",
          scheduleConfig: { frequency: "daily", time: "09:00" },
        })}
        recentRuns={[]}
        isSelected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/Daily/)).toBeInTheDocument();
  });

  it("displays schedule label for interval", () => {
    render(
      <SidebarJobNode
        job={makeJob({
          scheduleType: "interval",
          scheduleConfig: { amount: 30, unit: "minutes" },
        })}
        recentRuns={[]}
        isSelected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Every 30 mins")).toBeInTheDocument();
  });

  it("displays 'Manual' for manual jobs", () => {
    render(
      <SidebarJobNode
        job={makeJob({ scheduleType: "manual", scheduleConfig: {} })}
        recentRuns={[]}
        isSelected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  it("renders run status dots with correct titles", () => {
    const runs = [
      makeRun({ status: "succeeded" }),
      makeRun({ status: "failed" }),
      makeRun({ status: "running" }),
    ];
    render(
      <SidebarJobNode
        job={makeJob()}
        recentRuns={runs}
        isSelected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTitle("Succeeded")).toBeInTheDocument();
    expect(screen.getByTitle("Failed")).toBeInTheDocument();
    expect(screen.getByTitle("Running")).toBeInTheDocument();
  });

  it("limits to 5 dots max", () => {
    const runs = Array.from({ length: 8 }, (_, i) =>
      makeRun({ id: `run-${i}`, status: "succeeded" }),
    );
    render(
      <SidebarJobNode
        job={makeJob()}
        recentRuns={runs}
        isSelected={false}
        onSelect={vi.fn()}
      />,
    );
    const dots = screen.getAllByTitle("Succeeded");
    expect(dots).toHaveLength(5);
  });

  it("calls onSelect when clicked", () => {
    const onSelect = vi.fn();
    render(
      <SidebarJobNode
        job={makeJob()}
        recentRuns={[]}
        isSelected={false}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("applies selected styles", () => {
    render(
      <SidebarJobNode
        job={makeJob()}
        recentRuns={[]}
        isSelected={true}
        onSelect={vi.fn()}
      />,
    );
    const button = screen.getByRole("button");
    expect(button.className).toContain("bg-sidebar-accent");
  });

  it("renders svg icon when a valid icon name is set", () => {
    const { container } = render(
      <SidebarJobNode
        job={makeJob({ icon: "rocket" })}
        recentRuns={[]}
        isSelected={false}
        onSelect={vi.fn()}
      />,
    );
    // Valid icon names render as SVG Lucide icons
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders default Briefcase icon when icon is null", () => {
    const { container } = render(
      <SidebarJobNode
        job={makeJob({ icon: null })}
        recentRuns={[]}
        isSelected={false}
        onSelect={vi.fn()}
      />,
    );
    // Briefcase icon is rendered as an SVG
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useJobStore } from "./job-store";
import type { Job } from "@openorchestra/shared";

const mockJob: Job = {
  id: "j1",
  goalId: null,
  projectId: "p1",
  name: "Test job",
  description: null,
  prompt: "Run tests",
  scheduleType: "once",
  scheduleConfig: { fireAt: "2026-01-01T00:00:00Z" },
  isEnabled: true,
  workingDirectory: null,
  nextFireAt: "2026-01-01T00:00:00Z",
  correctionNote: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

// Mock the api module
vi.mock("@/lib/api", () => ({
  listJobs: vi.fn().mockResolvedValue([]),
  createJob: vi.fn().mockResolvedValue({
    id: "j-new",
    goalId: null,
    projectId: "p1",
    name: "New job",
    description: null,
    prompt: "Do something",
    scheduleType: "once",
    scheduleConfig: { fireAt: "2026-01-01T00:00:00Z" },
    isEnabled: true,
    workingDirectory: null,
    nextFireAt: "2026-01-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  }),
  updateJob: vi.fn(),
  deleteJob: vi.fn().mockResolvedValue({ deleted: true }),
}));

describe("JobStore", () => {
  beforeEach(() => {
    useJobStore.setState({
      jobs: [mockJob],
      loading: false,
      error: null,
    });
  });

  it("createJob adds the new job to the front of the list", async () => {
    const result = await useJobStore.getState().createJob({
      projectId: "p1",
      name: "New job",
      prompt: "Do something",
      scheduleType: "once",
      scheduleConfig: { fireAt: "2026-01-01T00:00:00Z" },
    });
    expect(result.id).toBe("j-new");
    const jobs = useJobStore.getState().jobs;
    expect(jobs).toHaveLength(2);
    expect(jobs[0].id).toBe("j-new");
    expect(jobs[1].id).toBe("j1");
  });

  it("deleteJob removes the job from the list", async () => {
    await useJobStore.getState().deleteJob("j1");
    expect(useJobStore.getState().jobs).toHaveLength(0);
  });

  it("updateJobInStore updates the correct job", () => {
    const updated = { ...mockJob, name: "Updated name" };
    useJobStore.getState().updateJobInStore(updated);
    const job = useJobStore.getState().jobs.find((j) => j.id === "j1");
    expect(job?.name).toBe("Updated name");
  });

  it("updateJobInStore does not affect other jobs", () => {
    const secondJob = { ...mockJob, id: "j2", name: "Second" };
    useJobStore.setState({ jobs: [mockJob, secondJob] });
    useJobStore.getState().updateJobInStore({ ...mockJob, name: "Changed" });
    const second = useJobStore.getState().jobs.find((j) => j.id === "j2");
    expect(second?.name).toBe("Second");
  });
});

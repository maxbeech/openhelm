import { describe, it, expect, beforeEach, vi } from "vitest";
import { useRunStore } from "./run-store";
import * as api from "@/lib/api";
import type { Run } from "@openhelm/shared";

vi.mock("@/lib/api");

const mockRun: Run = {
  id: "r1",
  jobId: "j1",
  status: "running",
  triggerSource: "manual",
  scheduledFor: null,
  startedAt: "2026-01-01T00:00:00Z",
  finishedAt: null,
  exitCode: null,
  summary: null,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("RunStore", () => {
  beforeEach(() => {
    useRunStore.setState({
      runs: [mockRun],
      loading: false,
      error: null,
    });
    vi.mocked(api.getSchedulerStatus).mockResolvedValue({ paused: false });
  });

  it("updates run status by ID", () => {
    useRunStore.getState().updateRunStatus("r1", "succeeded");
    const run = useRunStore.getState().runs.find((r) => r.id === "r1");
    expect(run?.status).toBe("succeeded");
  });

  it("does not affect other runs when updating status", () => {
    const otherRun: Run = { ...mockRun, id: "r2", status: "queued" };
    useRunStore.setState({ runs: [mockRun, otherRun] });
    useRunStore.getState().updateRunStatus("r1", "failed");
    const other = useRunStore.getState().runs.find((r) => r.id === "r2");
    expect(other?.status).toBe("queued");
  });

  it("updates partial run data in store", () => {
    useRunStore.getState().updateRunInStore({
      id: "r1",
      status: "succeeded",
      finishedAt: "2026-01-01T00:05:00Z",
      summary: "Done",
    });
    const run = useRunStore.getState().runs.find((r) => r.id === "r1");
    expect(run?.status).toBe("succeeded");
    expect(run?.summary).toBe("Done");
    expect(run?.finishedAt).toBe("2026-01-01T00:05:00Z");
  });

  it("ignores updates for non-existent run IDs", () => {
    useRunStore.getState().updateRunStatus("nonexistent", "failed");
    expect(useRunStore.getState().runs).toHaveLength(1);
    expect(useRunStore.getState().runs[0].status).toBe("running");
  });

  it("deleteRun removes the run from the store", async () => {
    vi.mocked(api.deleteRun).mockResolvedValueOnce({ deleted: true });
    await useRunStore.getState().deleteRun("r1");
    expect(api.deleteRun).toHaveBeenCalledWith("r1");
    expect(useRunStore.getState().runs).toHaveLength(0);
  });

  it("clearRunsByJob removes all runs for the job", async () => {
    const run2: Run = { ...mockRun, id: "r2", jobId: "j2" };
    useRunStore.setState({ runs: [mockRun, run2] });
    vi.mocked(api.clearRunsByJob).mockResolvedValueOnce({ cleared: 1 });
    await useRunStore.getState().clearRunsByJob("j1");
    expect(api.clearRunsByJob).toHaveBeenCalledWith({ jobId: "j1" });
    const remaining = useRunStore.getState().runs;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("r2");
  });

  it("retryRun calls api.triggerRun with jobId and parentRunId", async () => {
    const correctiveRun: Run = {
      ...mockRun,
      id: "r-corrective",
      triggerSource: "corrective",
      parentRunId: "r1",
    };
    vi.mocked(api.triggerRun).mockResolvedValueOnce(correctiveRun);

    const result = await useRunStore.getState().retryRun("j1", "r1");

    expect(api.triggerRun).toHaveBeenCalledWith({ jobId: "j1", parentRunId: "r1" });
    expect(result.triggerSource).toBe("corrective");
    expect(result.parentRunId).toBe("r1");

    const stored = useRunStore.getState().runs.find((r) => r.id === "r-corrective");
    expect(stored).toBeDefined();
  });

  it("triggerDeferredRun calls api.triggerRun with jobId and fireAt", async () => {
    const fireAt = "2026-06-01T10:00:00Z";
    const deferredRun: Run = {
      ...mockRun,
      id: "r-deferred",
      status: "deferred",
      scheduledFor: fireAt,
    };
    vi.mocked(api.triggerRun).mockResolvedValueOnce(deferredRun);

    const result = await useRunStore.getState().triggerDeferredRun("j1", fireAt);

    expect(api.triggerRun).toHaveBeenCalledWith({ jobId: "j1", fireAt });
    expect(result.status).toBe("deferred");
    expect(result.scheduledFor).toBe(fireAt);

    const stored = useRunStore.getState().runs.find((r) => r.id === "r-deferred");
    expect(stored).toBeDefined();
  });
});

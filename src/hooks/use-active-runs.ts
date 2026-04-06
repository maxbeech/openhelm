import { useState, useEffect, useCallback } from "react";
import { useAgentEvent } from "./use-agent-event";
import { listRuns, getJob } from "@/lib/api";
import type { Run, Job } from "@openhelm/shared";

export interface ActiveRun {
  run: Run;
  job: Job | null;
}

/**
 * Returns currently running and queued runs with their associated job metadata.
 * Refreshes automatically on `run.statusChanged` events.
 */
export function useActiveRuns(projectId?: string | null): {
  activeRuns: ActiveRun[];
  loading: boolean;
} {
  const [activeRuns, setActiveRuns] = useState<ActiveRun[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [running, queued] = await Promise.all([
        listRuns({ status: "running", projectId: projectId ?? undefined, limit: 20 }),
        listRuns({ status: "queued", projectId: projectId ?? undefined, limit: 20 }),
      ]);

      const combined = [...running, ...queued];

      // Fetch job metadata for each run in parallel; tolerate individual failures
      const withJobs = await Promise.all(
        combined.map(async (run) => {
          try {
            const job = await getJob(run.jobId);
            return { run, job };
          } catch {
            return { run, job: null };
          }
        }),
      );

      setActiveRuns(withJobs);
    } catch {
      // Non-fatal — leave previous state
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useAgentEvent("run.statusChanged", () => {
    void refresh();
  });

  return { activeRuns, loading };
}

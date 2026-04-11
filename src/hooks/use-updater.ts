import { useState, useCallback, useRef, useEffect } from "react";
import { useUpdaterStore } from "@/stores/updater-store";
import { agentClient } from "@/lib/agent-client";
import { isLocalMode } from "@/lib/mode";
import type { SchedulerStatus } from "@openhelm/shared";

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "confirming"    // active runs detected — user must choose
  | "waiting"       // waiting for active runs to finish before auto-install
  | "downloading"
  | "ready"
  | "error"
  | "not-available";

interface UpdaterState {
  status: UpdaterStatus;
  currentVersion: string;
  updateVersion: string | null;
  updateNotes: string | null;
  downloadProgress: number | null;
  error: string | null;
  activeRunCount: number;
}

interface UseUpdaterReturn extends UpdaterState {
  shouldCheckUpdates: boolean;
  checkForUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  forceInstallUpdate: () => Promise<void>;
  waitAndInstall: () => void;
  dismissUpdate: () => void;
}

const WAIT_POLL_INTERVAL_MS = 5_000;

export function useUpdater(): UseUpdaterReturn {
  const { shouldCheckUpdates } = useUpdaterStore();
  const [state, setState] = useState<UpdaterState>({
    status: "idle",
    currentVersion: "",
    updateVersion: null,
    updateNotes: null,
    downloadProgress: null,
    error: null,
    activeRunCount: 0,
  });

  // Store the update object between check and install
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingUpdate = useRef<any>(null);
  const checkingRef = useRef(false);
  const waitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up wait polling on unmount
  useEffect(() => {
    return () => {
      if (waitTimerRef.current) clearInterval(waitTimerRef.current);
    };
  }, []);

  const checkForUpdate = useCallback(async () => {
    if (!isLocalMode) return;
    if (checkingRef.current) return;
    checkingRef.current = true;
    setState((s) => ({ ...s, status: "checking", error: null }));
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      const { check } = await import("@tauri-apps/plugin-updater");
      const [currentVersion, update] = await Promise.all([
        getVersion(),
        check(),
      ]);
      if (update?.available) {
        pendingUpdate.current = update;
        setState((s) => ({
          ...s,
          status: "available",
          currentVersion,
          updateVersion: update.version ?? null,
          updateNotes: update.body ?? null,
        }));
      } else {
        setState((s) => ({ ...s, status: "not-available", currentVersion }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("release JSON") || msg.includes("404") || msg.includes("fetch")) {
        setState((s) => ({ ...s, status: "not-available" }));
      } else {
        setState((s) => ({ ...s, status: "error", error: msg }));
      }
    } finally {
      checkingRef.current = false;
    }
  }, []);

  /** Download and install the update (called after confirmation) */
  const doInstall = useCallback(async () => {
    const update = pendingUpdate.current;
    if (!update) return;

    // Signal agent to prepare for update (pauses scheduler, sets flag)
    try {
      await agentClient.request("executor.prepareForUpdate");
    } catch {
      // Non-fatal — update can still proceed
    }

    setState((s) => ({ ...s, status: "downloading", downloadProgress: 0 }));
    try {
      await update.download((event: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => {
        if (event.event === "Started") {
          setState((s) => ({ ...s, downloadProgress: 0 }));
        } else if (event.event === "Progress") {
          const total = event.data?.contentLength;
          const chunk = event.data?.chunkLength ?? 0;
          if (total && total > 0) {
            setState((s) => ({
              ...s,
              downloadProgress: Math.min(
                100,
                ((s.downloadProgress ?? 0) + chunk / total) * 100,
              ),
            }));
          }
        } else if (event.event === "Finished") {
          setState((s) => ({ ...s, downloadProgress: 100 }));
        }
      });
      setState((s) => ({ ...s, status: "ready" }));
      await update.install();
      // Relaunch the app after successful install
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("relaunch_app");
    } catch (err) {
      // Cancel the update preparation since install failed
      try {
        await agentClient.request("executor.cancelPrepareForUpdate");
      } catch { /* non-fatal */ }
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  /** Check for active runs; if none, install immediately. Otherwise show confirmation. */
  const installUpdate = useCallback(async () => {
    const update = pendingUpdate.current;
    if (!update) return;

    try {
      const schedulerStatus = await agentClient.request<SchedulerStatus>("scheduler.status");
      const totalActive = schedulerStatus.activeRuns + schedulerStatus.queuedRuns;

      if (totalActive > 0) {
        setState((s) => ({
          ...s,
          status: "confirming",
          activeRunCount: totalActive,
        }));
        return;
      }
    } catch {
      // Can't reach agent — safe to install (agent will recover)
    }

    await doInstall();
  }, [doInstall]);

  /** Force install even with active runs (user chose "Update Now") */
  const forceInstallUpdate = useCallback(async () => {
    await doInstall();
  }, [doInstall]);

  /** Wait for all runs to finish, then auto-install */
  const waitAndInstall = useCallback(() => {
    setState((s) => ({ ...s, status: "waiting" }));

    // Poll scheduler status until no active runs remain
    waitTimerRef.current = setInterval(async () => {
      try {
        const schedulerStatus = await agentClient.request<SchedulerStatus>("scheduler.status");
        const totalActive = schedulerStatus.activeRuns + schedulerStatus.queuedRuns;

        setState((s) => ({ ...s, activeRunCount: totalActive }));

        if (totalActive === 0) {
          if (waitTimerRef.current) {
            clearInterval(waitTimerRef.current);
            waitTimerRef.current = null;
          }
          await doInstall();
        }
      } catch {
        // Agent unreachable — proceed with install
        if (waitTimerRef.current) {
          clearInterval(waitTimerRef.current);
          waitTimerRef.current = null;
        }
        await doInstall();
      }
    }, WAIT_POLL_INTERVAL_MS);
  }, [doInstall]);

  const dismissUpdate = useCallback(() => {
    // Stop any wait polling
    if (waitTimerRef.current) {
      clearInterval(waitTimerRef.current);
      waitTimerRef.current = null;
    }
    // Cancel any pending update preparation
    agentClient.request("executor.cancelPrepareForUpdate").catch(() => {});
    setState((s) => ({ ...s, status: "idle", activeRunCount: 0 }));
  }, []);

  return {
    ...state,
    shouldCheckUpdates,
    checkForUpdate,
    installUpdate,
    forceInstallUpdate,
    waitAndInstall,
    dismissUpdate,
  };
}

import { useState, useCallback, useRef } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { useUpdaterStore } from "@/stores/updater-store";

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "ready"
  | "error";

interface UpdaterState {
  status: UpdaterStatus;
  currentVersion: string;
  updateVersion: string | null;
  updateNotes: string | null;
  downloadProgress: number | null;
  error: string | null;
}

interface UseUpdaterReturn extends UpdaterState {
  shouldCheckUpdates: boolean;
  checkForUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  dismissUpdate: () => void;
}

export function useUpdater(): UseUpdaterReturn {
  const { shouldCheckUpdates } = useUpdaterStore();
  const [state, setState] = useState<UpdaterState>({
    status: "idle",
    currentVersion: "",
    updateVersion: null,
    updateNotes: null,
    downloadProgress: null,
    error: null,
  });

  // Store the update object between check and install
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingUpdate = useRef<any>(null);
  const checkingRef = useRef(false);

  const checkForUpdate = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setState((s) => ({ ...s, status: "checking", error: null }));
    try {
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
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      checkingRef.current = false;
    }
  }, []);

  const installUpdate = useCallback(async () => {
    const update = pendingUpdate.current;
    if (!update) return;
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
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    setState((s) => ({ ...s, status: "idle" }));
  }, []);

  return {
    ...state,
    shouldCheckUpdates,
    checkForUpdate,
    installUpdate,
    dismissUpdate,
  };
}

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.1.1"),
}));

vi.mock("@/stores/updater-store", () => ({
  useUpdaterStore: vi.fn().mockReturnValue({ shouldCheckUpdates: false }),
}));

vi.mock("@/lib/agent-client", () => ({
  agentClient: {
    request: vi.fn().mockResolvedValue({ activeRuns: 0, queuedRuns: 0 }),
  },
}));

import { useUpdater } from "./use-updater";
import * as updaterPlugin from "@tauri-apps/plugin-updater";
import { useUpdaterStore } from "@/stores/updater-store";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useUpdaterStore).mockReturnValue({ shouldCheckUpdates: false, setShouldCheckUpdates: vi.fn() });
});

describe("useUpdater", () => {
  it("starts in idle state", () => {
    vi.mocked(updaterPlugin.check).mockResolvedValue(null);
    const { result } = renderHook(() => useUpdater());
    expect(result.current.status).toBe("idle");
    expect(result.current.updateVersion).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("transitions checking → available when update exists", async () => {
    const mockUpdate = {
      available: true,
      version: "0.2.0",
      body: "New features",
      download: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(updaterPlugin.check).mockResolvedValue(mockUpdate as never);
    const { result } = renderHook(() => useUpdater());

    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(result.current.status).toBe("available");
    expect(result.current.updateVersion).toBe("0.2.0");
    expect(result.current.updateNotes).toBe("New features");
    expect(result.current.currentVersion).toBe("0.1.1");
  });

  it("transitions checking → not-available when no update", async () => {
    vi.mocked(updaterPlugin.check).mockResolvedValue(null);
    const { result } = renderHook(() => useUpdater());

    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(result.current.status).toBe("not-available");
  });

  it("tracks download progress through Started/Progress/Finished events", async () => {
    let capturedCallback: ((e: unknown) => void) | null = null;
    const mockUpdate = {
      available: true,
      version: "0.2.0",
      body: "",
      download: vi.fn().mockImplementation(async (cb: (e: unknown) => void) => {
        capturedCallback = cb;
        cb({ event: "Started" });
        cb({ event: "Progress", data: { contentLength: 1000, chunkLength: 500 } });
        cb({ event: "Finished" });
      }),
      install: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(updaterPlugin.check).mockResolvedValue(mockUpdate as never);

    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.checkForUpdate(); });
    await act(async () => { await result.current.installUpdate(); });

    expect(capturedCallback).not.toBeNull();
    expect(result.current.status).toBe("ready");
    expect(result.current.downloadProgress).toBe(100);
  });

  it("dismissUpdate resets status to idle", async () => {
    const mockUpdate = { available: true, version: "0.2.0", body: "" };
    vi.mocked(updaterPlugin.check).mockResolvedValue(mockUpdate as never);
    const { result } = renderHook(() => useUpdater());

    await act(async () => { await result.current.checkForUpdate(); });
    expect(result.current.status).toBe("available");

    act(() => { result.current.dismissUpdate(); });
    expect(result.current.status).toBe("idle");
  });

  it("sets error status when check throws", async () => {
    vi.mocked(updaterPlugin.check).mockRejectedValue(new Error("network error"));
    const { result } = renderHook(() => useUpdater());

    await act(async () => { await result.current.checkForUpdate(); });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("network error");
  });

  it("guards against concurrent check calls", async () => {
    let resolveCheck!: (v: null) => void;
    vi.mocked(updaterPlugin.check).mockReturnValue(new Promise((r) => { resolveCheck = r; }) as never);
    const { result } = renderHook(() => useUpdater());

    act(() => { void result.current.checkForUpdate(); });
    act(() => { void result.current.checkForUpdate(); }); // second call should be no-op
    resolveCheck(null);

    await act(async () => { await Promise.resolve(); });
    expect(updaterPlugin.check).toHaveBeenCalledTimes(1);
  });
});

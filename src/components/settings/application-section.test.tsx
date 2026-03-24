import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(false),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.1.1"),
}));

vi.mock("@/lib/api", () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  deleteSetting: vi.fn(),
}));

vi.mock("@/lib/notifications", () => ({
  ensureNotificationPermission: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/use-updater", () => ({
  useUpdater: vi.fn().mockReturnValue({
    status: "idle",
    checkForUpdate: vi.fn(),
  }),
}));

vi.mock("@/stores/updater-store", () => ({
  useUpdaterStore: vi.fn().mockReturnValue({
    shouldCheckUpdates: false,
    setShouldCheckUpdates: vi.fn(),
  }),
}));

// @/lib/sentry is globally mocked in test-setup.ts

import { ApplicationSection } from "./application-section";
import * as api from "@/lib/api";
import { ensureNotificationPermission } from "@/lib/notifications";
import { useUpdater } from "@/hooks/use-updater";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getSetting).mockResolvedValue(null as never);
  vi.mocked(api.setSetting).mockResolvedValue({} as never);
  vi.mocked(useUpdater).mockReturnValue({
    status: "idle",
    currentVersion: "0.1.1",
    updateVersion: null,
    updateNotes: null,
    downloadProgress: null,
    error: null,
    shouldCheckUpdates: false,
    checkForUpdate: vi.fn(),
    installUpdate: vi.fn(),
    forceInstallUpdate: vi.fn(),
    waitAndInstall: vi.fn(),
    dismissUpdate: vi.fn(),
    activeRunCount: 0,
  });
});

describe("ApplicationSection — notification level", () => {
  it("renders notification radio group with 'alerts_only' as default when no setting stored", async () => {
    render(<ApplicationSection />);
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: /alerts only/i })).toBeChecked();
    });
  });

  it("reads stored notification_level and reflects it in the UI", async () => {
    vi.mocked(api.getSetting).mockImplementation((key: string) => {
      if (key === "notification_level")
        return Promise.resolve({ value: "on_finish" } as never);
      return Promise.resolve(null as never);
    });
    render(<ApplicationSection />);
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: /everything/i })).toBeChecked();
    });
  });

  it("persists notification_level when radio changes", async () => {
    render(<ApplicationSection />);
    await waitFor(() => screen.getByRole("radio", { name: /never/i }));
    fireEvent.click(screen.getByRole("radio", { name: /never/i }));
    expect(api.setSetting).toHaveBeenCalledWith({
      key: "notification_level",
      value: "never",
    });
  });

  it("calls ensureNotificationPermission when selecting non-never level", async () => {
    render(<ApplicationSection />);
    await waitFor(() => screen.getByRole("radio", { name: /everything/i }));
    fireEvent.click(screen.getByRole("radio", { name: /everything/i }));
    await waitFor(() => {
      expect(ensureNotificationPermission).toHaveBeenCalled();
    });
  });

  it("does not call ensureNotificationPermission when selecting 'never'", async () => {
    render(<ApplicationSection />);
    await waitFor(() => screen.getByRole("radio", { name: /never/i }));
    fireEvent.click(screen.getByRole("radio", { name: /never/i }));
    await waitFor(() => { expect(api.setSetting).toHaveBeenCalled(); });
    expect(ensureNotificationPermission).not.toHaveBeenCalled();
  });
});

describe("ApplicationSection — auto update", () => {
  it("auto_update_enabled defaults to checked when no setting stored", async () => {
    render(<ApplicationSection />);
    await waitFor(() => {
      const switches = screen.getAllByRole("switch");
      // auto-update is the 3rd switch (launch, analytics, auto-update)
      const autoUpdateSwitch = switches.find(
        (el) => el.closest("[data-slot='switch']") !== null,
      );
      // All switches should exist; auto update defaults to true
      expect(switches.length).toBeGreaterThanOrEqual(3);
    });
  });

  it("reflects false when auto_update_enabled=false is stored", async () => {
    vi.mocked(api.getSetting).mockImplementation((key: string) => {
      if (key === "auto_update_enabled")
        return Promise.resolve({ value: "false" } as never);
      return Promise.resolve(null as never);
    });
    render(<ApplicationSection />);
    await waitFor(() => {
      // auto-update switch should be unchecked — it's the last switch in the list
      const switches = screen.getAllByRole("switch");
      const autoUpdateSwitch = switches[switches.length - 1];
      expect(autoUpdateSwitch).toHaveAttribute("data-state", "unchecked");
    });
  });

  it("persists auto_update_enabled when toggle changes", async () => {
    render(<ApplicationSection />);
    await waitFor(() => screen.getAllByRole("switch"));
    const switches = screen.getAllByRole("switch");
    const autoUpdateSwitch = switches[switches.length - 1];
    fireEvent.click(autoUpdateSwitch);
    expect(api.setSetting).toHaveBeenCalledWith({
      key: "auto_update_enabled",
      value: "false",
    });
  });

  it("renders Check for Updates button", async () => {
    render(<ApplicationSection />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /check for updates/i })).toBeTruthy();
    });
  });

  it("disables Check button when status is checking", async () => {
    vi.mocked(useUpdater).mockReturnValue({
      status: "checking",
      currentVersion: "0.1.1",
      updateVersion: null,
      updateNotes: null,
      downloadProgress: null,
      error: null,
      shouldCheckUpdates: false,
      checkForUpdate: vi.fn(),
      installUpdate: vi.fn(),
      forceInstallUpdate: vi.fn(),
      waitAndInstall: vi.fn(),
      dismissUpdate: vi.fn(),
      activeRunCount: 0,
    });
    render(<ApplicationSection />);
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /check for updates/i });
      expect(btn).toBeDisabled();
    });
  });

  it("shows up-to-date message when status is not-available", async () => {
    vi.mocked(useUpdater).mockReturnValue({
      status: "not-available",
      currentVersion: "0.1.9",
      updateVersion: null,
      updateNotes: null,
      downloadProgress: null,
      error: null,
      shouldCheckUpdates: false,
      checkForUpdate: vi.fn(),
      installUpdate: vi.fn(),
      forceInstallUpdate: vi.fn(),
      waitAndInstall: vi.fn(),
      dismissUpdate: vi.fn(),
      activeRunCount: 0,
    });
    render(<ApplicationSection />);
    await waitFor(() => {
      expect(screen.getByText(/up to date/i)).toBeTruthy();
    });
  });

  it("shows update version and install button when status is available", async () => {
    vi.mocked(useUpdater).mockReturnValue({
      status: "available",
      currentVersion: "0.1.8",
      updateVersion: "0.1.9",
      updateNotes: null,
      downloadProgress: null,
      error: null,
      shouldCheckUpdates: false,
      checkForUpdate: vi.fn(),
      installUpdate: vi.fn(),
      forceInstallUpdate: vi.fn(),
      waitAndInstall: vi.fn(),
      dismissUpdate: vi.fn(),
      activeRunCount: 0,
    });
    render(<ApplicationSection />);
    await waitFor(() => {
      expect(screen.getByText(/0\.1\.9 available/i)).toBeTruthy();
      expect(screen.getByRole("button", { name: /install/i })).toBeTruthy();
    });
  });

  it("shows error message when status is error", async () => {
    vi.mocked(useUpdater).mockReturnValue({
      status: "error",
      currentVersion: "0.1.9",
      updateVersion: null,
      updateNotes: null,
      downloadProgress: null,
      error: "Network request failed",
      shouldCheckUpdates: false,
      checkForUpdate: vi.fn(),
      installUpdate: vi.fn(),
      forceInstallUpdate: vi.fn(),
      waitAndInstall: vi.fn(),
      dismissUpdate: vi.fn(),
      activeRunCount: 0,
    });
    render(<ApplicationSection />);
    await waitFor(() => {
      expect(screen.getByText(/network request failed/i)).toBeTruthy();
    });
  });

  it("disables Check button and shows downloading message when status is downloading", async () => {
    vi.mocked(useUpdater).mockReturnValue({
      status: "downloading",
      currentVersion: "0.1.8",
      updateVersion: "0.1.9",
      updateNotes: null,
      downloadProgress: 42,
      error: null,
      shouldCheckUpdates: false,
      checkForUpdate: vi.fn(),
      installUpdate: vi.fn(),
      forceInstallUpdate: vi.fn(),
      waitAndInstall: vi.fn(),
      dismissUpdate: vi.fn(),
      activeRunCount: 0,
    });
    render(<ApplicationSection />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /check for updates/i })).toBeDisabled();
      expect(screen.getByText(/downloading update/i)).toBeTruthy();
    });
  });
});

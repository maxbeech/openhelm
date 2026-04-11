/**
 * Cloud-mode BrowserSetupStep — iframe path.
 *
 * The test environment is jsdom, where `isCloudMode === true` (see
 * src/lib/__tests__/mode.test.ts). We mock the api module so clicking
 * "Open Browser" returns a stream URL; the component should render the
 * iframe and wire the Done button to finalize, calling cancel on unmount.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const setupBrowserProfile = vi.fn();
const finalizeBrowserProfile = vi.fn();
const cancelBrowserSetup = vi.fn();

vi.mock("@/lib/api", () => ({
  setupBrowserProfile: (...args: unknown[]) => setupBrowserProfile(...args),
  finalizeBrowserProfile: (...args: unknown[]) => finalizeBrowserProfile(...args),
  cancelBrowserSetup: (...args: unknown[]) => cancelBrowserSetup(...args),
}));

// Agent events are local-mode only — stub the hook to a no-op.
vi.mock("@/hooks/use-agent-event", () => ({
  useAgentEvent: vi.fn(),
}));

import { BrowserSetupStep } from "./browser-setup-step";

describe("BrowserSetupStep (cloud mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserProfile.mockResolvedValue({
      launched: true,
      profileName: "cred-c1",
      message: "ok",
      sandboxId: "sbx-1",
      streamUrl: "https://sbx.example/stream?token=abc",
      expiresAt: Date.now() + 60_000,
    });
    finalizeBrowserProfile.mockResolvedValue({
      credentialId: "c1",
      status: "likely_logged_in",
      storageKey: "u1/c1.tar.gz",
      verifiedAt: new Date().toISOString(),
    });
    cancelBrowserSetup.mockResolvedValue({ cancelled: true });
  });

  it("renders the stream iframe after Open Browser and finalizes on Done", async () => {
    const onComplete = vi.fn();
    const onSkip = vi.fn();

    render(
      <BrowserSetupStep credentialId="c1" onComplete={onComplete} onSkip={onSkip} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open browser/i }));

    const iframe = await waitFor(() => screen.getByTitle("Remote browser"));
    expect(iframe).toBeInTheDocument();
    expect(iframe.getAttribute("src")).toBe("https://sbx.example/stream?token=abc");
    expect(setupBrowserProfile).toHaveBeenCalledWith({ credentialId: "c1" });

    fireEvent.click(screen.getByRole("button", { name: /done — save login/i }));

    await waitFor(() =>
      expect(finalizeBrowserProfile).toHaveBeenCalledWith({ sandboxId: "sbx-1" }),
    );
    await waitFor(() =>
      expect(screen.getByText(/session saved successfully/i)).toBeInTheDocument(),
    );
  });

  it("calls cancelBrowserSetup with sandboxId when unmounted mid-session", async () => {
    const { unmount } = render(
      <BrowserSetupStep credentialId="c1" onComplete={vi.fn()} onSkip={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open browser/i }));
    await waitFor(() => screen.getByTitle("Remote browser"));

    unmount();
    cleanup();

    await waitFor(() =>
      expect(cancelBrowserSetup).toHaveBeenCalledWith({ sandboxId: "sbx-1" }),
    );
  });

  it("surfaces an error when setup launch fails", async () => {
    setupBrowserProfile.mockResolvedValue({
      launched: false,
      profileName: "",
      message: "E2B out of capacity",
    });

    render(
      <BrowserSetupStep credentialId="c1" onComplete={vi.fn()} onSkip={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open browser/i }));

    await waitFor(() =>
      expect(screen.getByText(/e2b out of capacity/i)).toBeInTheDocument(),
    );
    expect(screen.queryByTitle("Remote browser")).not.toBeInTheDocument();
  });
});

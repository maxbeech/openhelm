import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UpdateBanner } from "./update-banner";

const baseProps = {
  updateVersion: null,
  downloadProgress: null,
  error: null,
  onInstall: vi.fn(),
  onDismiss: vi.fn(),
  onRetry: vi.fn(),
};

describe("UpdateBanner", () => {
  it("renders null when status is idle", () => {
    const { container } = render(<UpdateBanner {...baseProps} status="idle" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders null when status is not-available", () => {
    const { container } = render(<UpdateBanner {...baseProps} status="not-available" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders null when status is checking", () => {
    const { container } = render(<UpdateBanner {...baseProps} status="checking" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows version and action buttons when available", () => {
    render(
      <UpdateBanner
        {...baseProps}
        status="available"
        updateVersion="0.2.0"
      />,
    );
    expect(screen.getByText(/0\.2\.0/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /install/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /later/i })).toBeTruthy();
  });

  it("calls onInstall when Install button clicked", () => {
    const onInstall = vi.fn();
    render(
      <UpdateBanner
        {...baseProps}
        status="available"
        updateVersion="0.2.0"
        onInstall={onInstall}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /install/i }));
    expect(onInstall).toHaveBeenCalledOnce();
  });

  it("calls onDismiss when Later button clicked", () => {
    const onDismiss = vi.fn();
    render(
      <UpdateBanner
        {...baseProps}
        status="available"
        updateVersion="0.2.0"
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /later/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("shows progress bar when downloading", () => {
    render(
      <UpdateBanner {...baseProps} status="downloading" downloadProgress={42} />,
    );
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("shows Relaunch Now when ready", () => {
    const onInstall = vi.fn();
    render(
      <UpdateBanner {...baseProps} status="ready" onInstall={onInstall} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /relaunch/i }));
    expect(onInstall).toHaveBeenCalledOnce();
  });

  it("shows error message and Retry link when error", () => {
    const onRetry = vi.fn();
    render(
      <UpdateBanner
        {...baseProps}
        status="error"
        error="network error"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("network error")).toBeTruthy();
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
